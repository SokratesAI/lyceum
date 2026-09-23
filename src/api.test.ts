/** Tests for the shell's read API, against a stub CouchDB.
 *
 * The stub is deliberately literal about the shapes `tools.lyceum_import`
 * writes -- prefixed ids, `chapterIds`/`sourceIds` on the course, `order` on a
 * chapter -- because a test written against a shape the importer does not
 * produce would pass against nothing real.
 */
import { appendNote, httpVault, VaultConflict, type VaultStore } from "./vault.js";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import type { Couch, Doc } from "./couch.js";
import { NoToken, visibleMessages, type Agora } from "./agora.js";
import { briefing, contextBlock, parseMemories, parseRecalls, slug, stripMarkers } from "./memory.js";
import { anchorClaim, paragraphsOf } from "./claims.js";
import { basisOf } from "./api.js";

const DOCS: Doc[] = [
  {
    _id: "course:analytics",
    type: "course",
    slug: "analytics",
    title: "Analytics",
    spine: "the spine",
    chapterIds: ["chapter:analytics:b-second", "chapter:analytics:a-first"],
    sourceIds: ["source:analytics:paper"],
  },
  {
    _id: "chapter:analytics:b-second",
    type: "chapter",
    courseId: "course:analytics",
    slug: "b-second",
    title: "Second",
    body:
      "one is the paragraph this claim does not belong under, and nowhere else\n\n" +
      "two is the paragraph this claim belongs under, and nowhere else",
    order: 1,
    sourceIds: ["source:analytics:paper"],
  },
  {
    _id: "chapter:analytics:a-first",
    type: "chapter",
    courseId: "course:analytics",
    slug: "a-first",
    title: "First",
    body: "first body",
    order: 0,
    sourceIds: [],
  },
  // Claims on `b-second`, whose body is two paragraphs: "one" and "two".
  // Their text is deliberately longer than the 40-character floor in
  // `claims.ts`, because a shorter fragment is refused rather than anchored.
  {
    _id: "claim:analytics:b-second:000",
    type: "claim",
    courseId: "course:analytics",
    chapterId: "chapter:analytics:b-second",
    order: 0,
    text: "two is the paragraph this claim belongs under, and nowhere else",
    grade: "high",
    status: "grounded",
    quote: "the sentence in the source",
    checkedAgainst: "source:analytics:paper",
    sourceIds: ["source:analytics:paper"],
  },
  {
    _id: "claim:analytics:b-second:001",
    type: "claim",
    courseId: "course:analytics",
    chapterId: "chapter:analytics:b-second",
    order: 1,
    text: "a claim the extractor paraphrased so far that no fragment of it survives",
    grade: "ungrounded",
    status: "ungrounded",
    quote: null,
    checkedAgainst: null,
    sourceIds: [],
  },
  {
    _id: "source:analytics:paper",
    type: "source",
    courseId: "course:analytics",
    slug: "paper",
    title: "A paper",
    url: "https://example.invalid/paper",
    body: "raw",
  },
];

/** A writable stub: `put` lands in the same array the reads come out of, so a
 *  discussion created by one request is visible to the next one the way it is
 *  in CouchDB. A stub that swallowed the write would make every chat test
 *  pass against nothing. */
const makeStub = (docs: Doc[] = [...DOCS]): Couch => ({
  async allDocs(prefix) {
    return docs.filter((d) => d._id.startsWith(prefix));
  },
  async ids(prefix) {
    return docs.filter((d) => d._id.startsWith(prefix)).map((d) => d._id);
  },
  async get(id) {
    return docs.find((d) => d._id === id) ?? null;
  },
  async put(doc) {
    // Replace by id rather than push: CouchDB has one document per id, and a
    // stub that appends would make an upsert look like it worked while the
    // old copy was still the one `get` found.
    const at = docs.findIndex((d) => d._id === doc._id);
    if (at >= 0) docs[at] = doc;
    else docs.push(doc);
    return { ...doc, _rev: "1-stub" };
  },
});

const makeAgora = (
  sent: { id: string; text: string; sender?: string }[] = [],
  reply?: { sender: string; text: string; ts: string | null; context?: boolean }[],
): Agora => ({
  async createConversation(name) {
    return `conv-for-${name}`;
  },
  async postMessage(conversationId, text) {
    // Everything this app posts goes in as the owner -- measured, not assumed:
    // Agora records a message from another sender and the persona never reads
    // it. So the stub records the one sender there is.
    sent.push({ id: conversationId, text, sender: "Edvard" });
    return "msg-1";
  },
  async postContext(conversationId, text) {
    sent.push({ id: conversationId, text, sender: "Lyceum" });
    return "ctx-1";
  },
  async messages() {
    return (
      reply ?? [
        { sender: "Edvard", text: "what is a KPI", ts: "2026-09-20T22:00:00Z" },
        { sender: "Aristoteles", text: "a measure you act on", ts: "2026-09-20T22:00:05Z" },
      ]
    );
  },
});

const stub = makeStub();
const app = createApp(stub, makeAgora());

describe("GET /api/courses", () => {
  it("counts chapters and sources without shipping their bodies", async () => {
    const res = await request(app).get("/api/courses");
    expect(res.status).toBe(200);
    expect(res.body.courses).toEqual([
      { slug: "analytics", title: "Analytics", chapterCount: 2, sourceCount: 1, cardCount: 0 },
    ]);
    expect(JSON.stringify(res.body)).not.toContain("first body");
  });
});

describe("GET /api/courses/:slug", () => {
  it("returns chapters in reading order, not id order", async () => {
    const res = await request(app).get("/api/courses/analytics");
    expect(res.status).toBe(200);
    expect(res.body.chapters.map((c: Doc) => c.title)).toEqual(["First", "Second"]);
    expect(res.body.sources[0].url).toBe("https://example.invalid/paper");
  });

  it("counts the course's claims per GRADE level for the evidence bar", async () => {
    const res = await request(app).get("/api/courses/analytics");
    expect(res.body.grades).toEqual({ high: 1, ungrounded: 1 });
  });

  it("carries the demo's basis paragraph, counted from the real course", async () => {
    const res = await request(app).get("/api/courses/analytics");
    expect(res.body.course.basis).toContain("2 chapters and 1 source file,");
  });

  it("404s on a course that is not there", async () => {
    const res = await request(app).get("/api/courses/nope");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/chapters/:id", () => {
  it("returns the body the reading view renders", async () => {
    const res = await request(app).get("/api/chapters/chapter:analytics:a-first");
    expect(res.status).toBe(200);
    expect(res.body.chapter.body).toBe("first body");
  });

  it("refuses a document of another type under a chapter id", async () => {
    const res = await request(app).get("/api/chapters/source:analytics:paper");
    expect(res.status).toBe(404);
  });
});

describe("the shell itself", () => {
  it("serves index.html at /", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="app">');
    expect(res.text).toContain("/vendor/preact-htm.js");
  });

  it("serves the deep link a reload lands on with the shell, not a 404", async () => {
    const res = await request(app).get("/courses/analytics");
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="app">');
  });

  it("serves the service worker stamped with this build and never cached", async () => {
    const res = await request(app).get("/sw.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.text).not.toContain("__BUILD__");
    expect(res.text).toMatch(/const BUILD = '[0-9a-f]{12}';/);
  });

  it("precaches only files that exist, since one 404 fails the worker's install", async () => {
    const sw = (await request(app).get("/sw.js")).text;
    const list = sw.match(/const SHELL_FILES = \[([^\]]*)\]/);
    expect(list).not.toBeNull();
    const files = [...list![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const res = await request(app).get(f);
      expect(res.status, f).toBe(200);
      expect(res.text ?? "", f).not.toContain(f === "/" ? "__never__" : '<div id="app">');
    }
  });

  it("declares installable icons that are real PNGs of the size they claim", async () => {
    const manifest = JSON.parse((await request(app).get("/manifest.webmanifest")).text);
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) {
      const res = await request(app).get(icon.src).buffer(true).parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
      const png = res.body as Buffer;
      expect(png.subarray(1, 4).toString(), icon.src).toBe("PNG");
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.src).toBe(icon.sizes);
    }
  });

  it("keeps an unknown API path a JSON 404, not the shell", async () => {
    const res = await request(app).get("/api/nothing-here");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("<div id=\"app\">");
  });

  it("turns a CouchDB failure into a 502 rather than a hang", async () => {
    const broken = createApp({
      async allDocs() { throw new Error("CouchDB 401 on course:"); },
      async ids() { throw new Error("CouchDB 401 on course:"); },
      async get() { throw new Error("CouchDB 401"); },
      async put() { throw new Error("CouchDB 401"); },
    }, makeAgora());
    const res = await request(broken).get("/api/courses");
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("401");
  });

  it("answers /healthz without touching the database", async () => {
    const res = await request(createApp({
      async allDocs() { throw new Error("must not be called"); },
      async ids() { throw new Error("must not be called"); },
      async get() { throw new Error("must not be called"); },
      async put() { throw new Error("must not be called"); },
    }, makeAgora())).get("/healthz");
    expect(res.status).toBe(200);
  });
});

describe("discussions with Aristoteles", () => {
  it("starts a thread, lists it, and points it at an Agora conversation", async () => {
    const fresh = makeStub([...DOCS]);
    const chat = createApp(fresh, makeAgora());

    const made = await request(chat).post("/api/discussions").send({ title: "OKRs" });
    expect(made.status).toBe(201);
    expect(made.body.discussion.conversationId).toBe("conv-for-Lyceum — OKRs");

    const list = await request(chat).get("/api/discussions");
    expect(list.status).toBe(200);
    expect(list.body.discussions.map((d: Doc) => d.title)).toEqual(["OKRs"]);
    expect(list.body.discussions[0].scope).toBe("global");
  });

  it("refuses a thread with no title", async () => {
    const res = await request(app).post("/api/discussions").send({ title: "  " });
    expect(res.status).toBe(400);
  });

  it("reads the transcript out of Agora and flags a reply still coming", async () => {
    const fresh = makeStub([...DOCS]);
    const chat = createApp(fresh, makeAgora());
    const made = await request(chat).post("/api/discussions").send({ title: "OKRs" });

    const read = await request(chat).get(`/api/discussions/${made.body.discussion.id}/messages`);
    expect(read.status).toBe(200);
    expect(read.body.messages.map((m: Doc) => m.sender)).toEqual(["Edvard", "Aristoteles"]);
    // Aristoteles spoke last, so nothing is pending and the page must settle.
    expect(read.body.waiting).toBe(false);
  });

  it("waits when his message is the last one", async () => {
    const fresh = makeStub([...DOCS]);
    const onlyHim: Agora = {
      ...makeAgora(),
      async messages() {
        return [{ sender: "Edvard", text: "still typing at it", ts: null }];
      },
    };
    const chat = createApp(fresh, onlyHim);
    const made = await request(chat).post("/api/discussions").send({ title: "OKRs" });
    const read = await request(chat).get(`/api/discussions/${made.body.discussion.id}/messages`);
    expect(read.body.waiting).toBe(true);
  });

  it("sends his message into that conversation and nowhere else", async () => {
    const sent: { id: string; text: string; sender?: string }[] = [];
    const fresh = makeStub([...DOCS]);
    const chat = createApp(fresh, makeAgora(sent));
    const made = await request(chat).post("/api/discussions").send({ title: "OKRs" });

    const res = await request(chat)
      .post(`/api/discussions/${made.body.discussion.id}/messages`)
      .send({ text: "what is a KPI" });
    expect(res.status).toBe(201);
    // The briefing goes first under Lyceum's own sender (agora#102); his
    // message is his words alone (issue #286).
    expect(sent.map((m) => m.sender)).toEqual(["Lyceum", "Edvard"]);
    expect(sent[1].id).toBe("conv-for-Lyceum — OKRs");
    expect(sent[1].text).toBe("what is a KPI");
    expect(sent[0].text).not.toContain("what is a KPI");
  });

  it("opens a thread about one claim and hands the claim to Aristoteles once", async () => {
    const sent: { id: string; text: string; sender?: string }[] = [];
    const chat = createApp(makeStub([...DOCS]), makeAgora(sent));
    const about = { kind: "claim", text: "Specific goals beat vague ones.", grade: "high", where: "Goal setting" };
    const made = await request(chat).post("/api/discussions").send({ title: "Specific goals", about });
    expect(made.status).toBe(201);
    const id = made.body.discussion.id;

    const read = await request(chat).get(`/api/discussions/${id}/messages`);
    expect(read.body.discussion.about).toEqual(about);
    const list = await request(chat).get("/api/discussions");
    expect(list.body.discussions[0].about).toEqual(about);

    await request(chat).post(`/api/discussions/${id}/messages`).send({ text: "why?" });
    await request(chat).post(`/api/discussions/${id}/messages`).send({ text: "and then?" });
    expect(sent[0].text).toContain('The claim: "Specific goals beat vague ones."');
    expect(sent[0].text).toContain("graded high");
    expect(sent[0].sender).toBe("Lyceum");
    expect(sent.slice(1).map((m) => [m.sender, m.text])).toEqual([["Edvard", "why?"], ["Edvard", "and then?"]]);
  });

  it("keeps an ordinary thread about nothing, and refuses an about it cannot read", async () => {
    const sent: { id: string; text: string; sender?: string }[] = [];
    const chat = createApp(makeStub([...DOCS]), makeAgora(sent));
    const plain = await request(chat).post("/api/discussions").send({ title: "OKRs" });
    const read = await request(chat).get(`/api/discussions/${plain.body.discussion.id}/messages`);
    expect(read.body.discussion.about).toBeNull();
    await request(chat).post(`/api/discussions/${plain.body.discussion.id}/messages`).send({ text: "hi" });
    expect(sent[0].text).not.toContain("He opened this discussion");

    for (const about of ["a claim", { kind: "rumour", text: "x" }, { kind: "claim", text: "  " }]) {
      const res = await request(chat).post("/api/discussions").send({ title: "OKRs", about });
      expect(res.status).toBe(400);
    }
  });

  it("refuses an empty message rather than posting a blank one", async () => {
    const sent: { id: string; text: string; sender?: string }[] = [];
    const fresh = makeStub([...DOCS]);
    const chat = createApp(fresh, makeAgora(sent));
    const made = await request(chat).post("/api/discussions").send({ title: "OKRs" });
    const res = await request(chat)
      .post(`/api/discussions/${made.body.discussion.id}/messages`)
      .send({ text: "   " });
    expect(res.status).toBe(400);
    expect(sent).toEqual([]);
  });

  it("drops the narration rows Agora emits while the model works", () => {
    // Rows copied off the live wire (conversation
    // 4b459ea2-31ec-4865-a28c-a646d24525fd, 2026-09-20 22:16 Oslo). A
    // narration row is an ordinary message carrying an `activity` object,
    // NOT a row with `type: "activity"`. Rendering it puts a bubble reading
    // "assistant_text: " above every real answer, which is what the first
    // version of this filter did.
    const rows = [
      { id: "a", sender: "Edvard", text: "wire check", ts: "2026-09-20T20:16:44.885Z" },
      {
        id: "b",
        sender: "Aristoteles",
        text: "assistant_text: ",
        ts: "2026-09-20T20:16:55.108Z",
        activity: { capability: "assistant_text", detail: "", toolUseId: "text-1", retracted: true },
      },
      {
        id: "c",
        sender: "Aristoteles",
        text: "Aristoteles here, wire's good.",
        ts: "2026-09-20T20:16:55.133Z",
      },
    ];
    expect(visibleMessages(rows).map((m) => m.text)).toEqual([
      "wire check",
      "Aristoteles here, wire's good.",
    ]);
    // The negative control: with the field gone the same row is kept, so the
    // test is measuring `activity` and not the word in the text.
    const withoutField = rows.map(({ activity, ...rest }: any) => rest);
    expect(visibleMessages(withoutField)).toHaveLength(3);
  });

  it("404s a discussion id that is not one, including a course id", async () => {
    const missing = await request(app).get("/api/discussions/discussion:nope/messages");
    expect(missing.status).toBe(404);
    const wrongType = await request(app).get("/api/discussions/course:analytics/messages");
    expect(wrongType.status).toBe(404);
  });

  it("answers 503, not 502, when the pod holds no AGORA_TOKEN", async () => {
    const tokenless: Agora = {
      async createConversation() { throw new NoToken(); },
      async postMessage() { throw new NoToken(); },
      async postContext() { throw new NoToken(); },
      async messages() { throw new NoToken(); },
    };
    const chat = createApp(makeStub([...DOCS]), tokenless);
    const res = await request(chat).post("/api/discussions").send({ title: "OKRs" });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("AGORA_TOKEN");
  });

  it("keeps a real Agora failure a 502", async () => {
    const broken: Agora = {
      ...makeAgora(),
      async createConversation() { throw new Error("Agora 500 on /conversations"); },
    };
    const chat = createApp(makeStub([...DOCS]), broken);
    const res = await request(chat).post("/api/discussions").send({ title: "OKRs" });
    expect(res.status).toBe(502);
  });
});

/** Cross-chat memory -- the second half of build step 5.
 *
 * The parse and the briefing are pure functions and tested directly; the two
 * behaviours that only exist once the routes are wired -- a memory written by
 * a reply, and a recall answered back into the thread -- go through the app
 * with a stub that actually stores what it is given.
 */
describe("Aristoteles's memory", () => {
  it("parses a memory out of a reply and leaves the prose readable", () => {
    const text =
      'A KPI is a measure you act on.\n\n<memory name="Edvard\'s first project" ' +
      'description="the OKR framework, DSRM stage 1">He picked goal-setting as project #1.</memory>\n\nWhat next?';
    expect(parseMemories(text)).toEqual([
      {
        name: "Edvard's first project",
        description: "the OKR framework, DSRM stage 1",
        body: "He picked goal-setting as project #1.",
      },
    ]);
    expect(stripMarkers(text)).toBe("A KPI is a measure you act on.\n\nWhat next?");
    // Negative control: ordinary prose carries no memory, so the parser is
    // measuring the marker and not the word.
    expect(parseMemories("I remember that he picked goal-setting.")).toEqual([]);
  });

  it("reads a recall, deduplicates it, and takes it out of the bubble", () => {
    const text = 'Let me check. <recall name="Edvard\'s first project"/> <recall name="edvard-s-first-project"/>';
    expect(parseRecalls(text)).toEqual(["edvard-s-first-project"]);
    expect(stripMarkers(text)).toBe("Let me check.");
  });

  it("slugs two spellings of one name to one id", () => {
    expect(slug("Goal setting")).toBe("goal-setting");
    expect(slug("goal-setting")).toBe("goal-setting");
  });

  it("briefs an empty memory and a populated one differently", () => {
    expect(briefing([])).toContain("You remember nothing yet");
    const withOne = briefing([{ _id: "memory:okrs", name: "OKRs", description: "his framework" }]);
    expect(withOne).toContain("- OKRs — his framework");
    expect(withOne).not.toContain("You remember nothing yet");
  });

  it("rides the index in on his first message, once per thread", async () => {
    const sent: { id: string; text: string; sender?: string }[] = [];
    const docs: Doc[] = [
      ...DOCS,
      { _id: "memory:okrs", type: "memory", name: "OKRs", description: "his framework", body: "the long body" },
    ];
    const chat = createApp(makeStub(docs), makeAgora(sent));
    const made = await request(chat).post("/api/discussions").send({ title: "OKRs" });
    // Creating the thread costs no model call and says nothing.
    expect(sent).toEqual([]);

    const id = made.body.discussion.id;
    await request(chat).post(`/api/discussions/${id}/messages`).send({ text: "first" });
    expect(sent.map((m) => m.sender)).toEqual(["Lyceum", "Edvard"]);
    expect(sent[0].text).toContain("- OKRs — his framework");
    // The index and not the bodies: that is the whole point of an index.
    expect(sent[0].text).not.toContain("the long body");

    await request(chat).post(`/api/discussions/${id}/messages`).send({ text: "second" });
    expect(sent).toHaveLength(3);
    expect(sent[2].text).toBe("second");
  });

  it("hides the block it rode in on from the page", () => {
    const text = `${contextBlock("What you already remember:\n- OKRs — his framework")}\n\nwhat is a KPI`;
    expect(stripMarkers(text)).toBe("what is a KPI");
  });

  it("stores a memory a reply wrote, and stores it once over two polls", async () => {
    const docs: Doc[] = [...DOCS];
    const chat = createApp(
      makeStub(docs),
      makeAgora([], [
        { sender: "Edvard", text: "my first project is goal-setting", ts: "2026-09-20T22:00:00Z" },
        {
          sender: "Aristoteles",
          text: 'Noted.\n<memory name="First project" description="what he chose">goal-setting</memory>',
          ts: "2026-09-20T22:00:05Z",
        },
      ]),
    );
    const made = await request(chat).post("/api/discussions").send({ title: "OKRs" });
    const id = made.body.discussion.id;

    const first = await request(chat).get(`/api/discussions/${id}/messages`);
    expect(first.status).toBe(200);
    // The marker never reaches the page.
    expect(first.body.messages.map((m: Doc) => m.text)).toEqual([
      "my first project is goal-setting",
      "Noted.",
    ]);

    await request(chat).get(`/api/discussions/${id}/messages`);
    const list = await request(chat).get("/api/memories");
    expect(list.body.memories.map((m: Doc) => m.name)).toEqual(["First project"]);
    expect(list.body.memories[0].body).toBe("goal-setting");
    expect(list.body.memories[0].fromDiscussion).toBe(id);
  });

  it("answers a recall by posting the body back, and only for the newest message", async () => {
    const sent: { id: string; text: string; sender?: string }[] = [];
    const docs: Doc[] = [
      ...DOCS,
      {
        _id: "memory:first-project",
        type: "memory",
        name: "First project",
        description: "what he chose",
        body: "goal-setting",
      },
    ];
    const chat = createApp(
      makeStub(docs),
      makeAgora(sent, [
        {
          sender: "Aristoteles",
          text: 'One moment. <recall name="First project"/>',
          ts: "2026-09-20T22:00:05Z",
        },
      ]),
    );
    const made = await request(chat).post("/api/discussions").send({ title: "OKRs" });
    await request(chat).get(`/api/discussions/${made.body.discussion.id}/messages`);

    const answers = sent.filter((m) => m.text.includes('Memory "'));
    expect(answers).toHaveLength(1);
    expect(answers[0].text).toContain("goal-setting");
    // Sent as Lyceum's context, never as his message (issue #286).
    expect(answers[0].sender).toBe("Lyceum");
  });

  it("does not post a body the thread already carries", async () => {
    // This is the loop guard, not a tidiness rule: an answered recall is an
    // owner message, which starts another model turn, which can recall again.
    const sent: { id: string; text: string; sender?: string }[] = [];
    const docs: Doc[] = [
      ...DOCS,
      {
        _id: "memory:first-project",
        type: "memory",
        name: "First project",
        description: "what he chose",
        body: "goal-setting",
      },
    ];
    const chat = createApp(
      makeStub(docs),
      makeAgora(sent, [
        { sender: "Edvard", text: contextBlock('Memory "First project":\n\ngoal-setting'), ts: "2026-09-20T22:00:06Z" },
        { sender: "Aristoteles", text: 'Again please. <recall name="First project"/>', ts: "2026-09-20T22:00:07Z" },
      ]),
    );
    const made = await request(chat).post("/api/discussions").send({ title: "OKRs" });
    await request(chat).get(`/api/discussions/${made.body.discussion.id}/messages`);
    expect(sent.filter((m) => m.text.includes('Memory "'))).toHaveLength(0);
  });

  it("drops a message that is nothing but a context block", async () => {
    const chat = createApp(
      makeStub([...DOCS]),
      makeAgora([], [
        { sender: "Edvard", text: "hello", ts: "2026-09-20T22:00:00Z" },
        { sender: "Aristoteles", text: "hello back", ts: "2026-09-20T22:00:01Z" },
        { sender: "Edvard", text: contextBlock('Memory "X":\n\nbody'), ts: "2026-09-20T22:00:02Z" },
        { sender: "Lyceum", text: 'Memory "Y":\n\nbody', ts: "2026-09-20T22:00:03Z", context: true },
      ]),
    );
    const made = await request(chat).post("/api/discussions").send({ title: "OKRs" });
    const read = await request(chat).get(`/api/discussions/${made.body.discussion.id}/messages`);
    expect(read.body.messages.map((m: Doc) => m.text)).toEqual(["hello", "hello back"]);
    // The newest row is a recall answer (context from Lyceum), so a reply is
    // coming and the page must keep polling though the newest bubble is Aristoteles.
    expect(read.body.waiting).toBe(true);
  });
});

/** Cards as `tools.lyceum_cards` writes them -- one of each behaviour the
 *  screen has to tell apart, not one of each type for its own sake. */
const CARDS: Doc[] = [
  {
    _id: "card:analytics:a-first:000",
    type: "card",
    cardType: "true_false",
    courseId: "course:analytics",
    chapterId: "chapter:analytics:a-first",
    claimId: "claim:analytics:a-first:000",
    grade: "high",
    claimStatus: "grounded",
    prompt: "A cohort shares a starting event.",
    answer: "true",
    options: [],
    why: "Definition.",
    sourceIds: ["source:analytics:paper"],
  },
  {
    _id: "card:analytics:a-first:001",
    type: "card",
    cardType: "multiple_choice",
    courseId: "course:analytics",
    chapterId: "chapter:analytics:a-first",
    claimId: "claim:analytics:a-first:001",
    grade: "moderate",
    claimStatus: "grounded",
    prompt: "Which comes second?",
    answer: "Define the metric",
    options: ["Ask the question", "Define the metric"],
    why: "Order matters.",
    sourceIds: [],
  },
  {
    _id: "card:analytics:a-first:002",
    type: "card",
    cardType: "design",
    courseId: "course:analytics",
    chapterId: "chapter:analytics:a-first",
    claimId: "claim:analytics:a-first:002",
    grade: "ungrounded",
    claimStatus: "ungrounded",
    prompt: "What would test this?",
    answer: "Compare retention curves.",
    options: [],
    why: "Asserted, untested.",
    sourceIds: [],
  },
];

describe("practice", () => {
  it("serves a course's cards with the claim's grade and its source titles", async () => {
    const app = createApp(makeStub([...DOCS, ...CARDS]), makeAgora());
    const res = await request(app).get("/api/courses/analytics/practice");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.cards).toHaveLength(3);
    const tf = res.body.cards.find((c: Doc) => c.cardType === "true_false");
    // True/false is stored with no options and has to arrive with two.
    expect(tf.options).toEqual(["True", "False"]);
    expect(tf.answer).toBe("True");
    expect(tf.grade).toBe("high");
    expect(tf.sources).toEqual(["A paper"]);
    // An ungrounded claim's card keeps that grade -- the whole rule of step 8.
    expect(res.body.cards.find((c: Doc) => c.cardType === "design").grade).toBe("ungrounded");
  });

  it("honours a limit and refuses to serve the whole database on one", async () => {
    const app = createApp(makeStub([...DOCS, ...CARDS]), makeAgora());
    const one = await request(app).get("/api/courses/analytics/practice?limit=1");
    expect(one.body.cards).toHaveLength(1);
    expect(one.body.total).toBe(3);
    const huge = await request(app).get("/api/courses/analytics/practice?limit=9999");
    expect(huge.body.cards).toHaveLength(3);
    const junk = await request(app).get("/api/courses/analytics/practice?limit=abc");
    expect(junk.body.cards).toHaveLength(3);
  });

  it("404s a course that does not exist", async () => {
    const app = createApp(makeStub([...DOCS, ...CARDS]), makeAgora());
    expect((await request(app).get("/api/courses/nope/practice")).status).toBe(404);
  });

  it("records a session and orders the next one by it", async () => {
    const docs = [...DOCS, ...CARDS];
    const app = createApp(makeStub(docs), makeAgora());
    const posted = await request(app)
      .post("/api/practice/answers")
      .send({
        answers: [
          { cardId: "card:analytics:a-first:000", result: "correct" },
          { cardId: "card:analytics:a-first:001", result: "missed" },
        ],
      });
    expect(posted.status).toBe(200);
    expect(posted.body.stored).toBe(2);

    const state = docs.find((d) => d._id === "cardstate:analytics:a-first:001");
    expect(state).toMatchObject({ type: "cardState", seen: 1, missed: 1, lastResult: "missed" });
    // Nothing is scheduled: there is no due date on a card state, ever.
    expect(Object.keys(state!)).not.toContain("due");

    // Unseen first, then the missed one, then the one he got right.
    const next = await request(app).get("/api/courses/analytics/practice");
    expect(next.body.cards.map((c: Doc) => c.id)).toEqual([
      "card:analytics:a-first:002",
      "card:analytics:a-first:001",
      "card:analytics:a-first:000",
    ]);
  });

  it("counts a second sighting rather than replacing the first", async () => {
    const docs = [...DOCS, ...CARDS];
    const app = createApp(makeStub(docs), makeAgora());
    const body = { answers: [{ cardId: "card:analytics:a-first:000", result: "missed" }] };
    await request(app).post("/api/practice/answers").send(body);
    await request(app).post("/api/practice/answers").send(body);
    expect(docs.find((d) => d._id === "cardstate:analytics:a-first:000")).toMatchObject({
      seen: 2,
      missed: 2,
    });
  });

  it("refuses an answer that names no real card, or a result it does not know", async () => {
    const docs = [...DOCS, ...CARDS];
    const app = createApp(makeStub(docs), makeAgora());
    const cases = [
      { answers: [{ cardId: "card:analytics:nope:000", result: "correct" }] },
      { answers: [{ cardId: "chapter:analytics:a-first", result: "correct" }] },
      { answers: [{ cardId: "card:analytics:a-first:000", result: "brilliant" }] },
      { answers: "all of them" },
    ];
    for (const body of cases) {
      const res = await request(app).post("/api/practice/answers").send(body);
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    // A refused post writes nothing.
    expect(docs.some((d) => d._id.startsWith("cardstate:"))).toBe(false);
  });

  it("puts a card count on the course list so Home never offers an empty session", async () => {
    const withCards = await request(createApp(makeStub([...DOCS, ...CARDS]), makeAgora())).get("/api/courses");
    expect(withCards.body.courses[0].cardCount).toBe(3);
    const without = await request(createApp(makeStub([...DOCS]), makeAgora())).get("/api/courses");
    expect(without.body.courses[0].cardCount).toBe(0);
  });
});

describe("claim marks in the reading view -- build step 7", () => {
  it("anchors a claim to the one paragraph its text is in, and titles its source", async () => {
    const res = await request(app).get("/api/chapters/chapter:analytics:b-second");
    expect(res.status).toBe(200);
    const placed = res.body.claims.find((c: any) => c.id === "claim:analytics:b-second:000");
    // Paragraph 1, not 0: both paragraphs end in the same words, and picking
    // the first match would put the mark under the wrong text.
    expect(placed.paragraph).toBe(1);
    expect(placed).toMatchObject({ grade: "high", status: "grounded", quote: "the sentence in the source" });
    expect(res.body.sources["source:analytics:paper"].title).toBe("A paper");
  });

  it("returns paragraph null rather than a guess when nothing matches", async () => {
    const res = await request(app).get("/api/chapters/chapter:analytics:b-second");
    const unplaced = res.body.claims.find((c: any) => c.id === "claim:analytics:b-second:001");
    expect(unplaced.paragraph).toBeNull();
    expect(unplaced.grade).toBe("ungrounded");
  });

  it("carries no claims, and no sources, for a chapter that has none", async () => {
    const res = await request(app).get("/api/chapters/chapter:analytics:a-first");
    expect(res.body.claims).toEqual([]);
    expect(res.body.sources).toEqual({});
  });

  it("refuses an ambiguous anchor instead of taking the first paragraph", () => {
    const paragraphs = paragraphsOf("the very same long sentence appears twice in this chapter\n\nthe very same long sentence appears twice in this chapter");
    expect(anchorClaim(paragraphs, { text: "the very same long sentence appears twice in this chapter" })).toBeNull();
  });

  it("matches across markdown emphasis and rewrapped whitespace", () => {
    const paragraphs = paragraphsOf("Cohort analysis is a **behavioral**\nanalytics technique used to segment users into groups.");
    expect(anchorClaim(paragraphs, { text: "Cohort analysis is a behavioral analytics technique used to segment users into groups." })).toBe(0);
  });

  it("refuses a fragment shorter than the floor, which would match by coincidence", () => {
    expect(anchorClaim(paragraphsOf("a short line"), { text: "a short line" })).toBeNull();
  });

  it("falls back to one sentence of a claim that joins two", () => {
    const paragraphs = paragraphsOf("An opening paragraph with nothing relevant in it whatsoever.\n\nDescriptive analytics is the most common and easiest form to implement.");
    const text = "Something the extractor invented at the front. Descriptive analytics is the most common and easiest form to implement.";
    expect(anchorClaim(paragraphs, { text })).toBe(1);
  });
});

describe("notes", () => {
  function memVault(seed: Record<string, Record<string, any>> = {}) {
    const docs: Record<string, Record<string, any>> = { ...seed };
    const store: VaultStore = {
      async get(db, id) { return docs[`${db}/${id}`] ?? null; },
      async put(db, doc) { docs[`${db}/${doc._id}`] = { ...doc, _rev: "2-x" }; },
    };
    const text = (db: string, id: string) =>
      (docs[`${db}/${id}`].children as string[]).map((c) => docs[`${db}/${c}`].data).join("");
    return { docs, store, text };
  }

  it("appends the note to the chosen vault file and leaves his chunks alone", async () => {
    const v = memVault({
      "obsidian/learn.md": { _id: "learn.md", _rev: "1-a", children: ["h:old"], size: 9, ctime: 5, type: "plain" },
      "obsidian/h:old": { _id: "h:old", data: "# Learn\nx", type: "leaf" },
    });
    const app = createApp(makeStub(), makeAgora(), v.store);
    const res = await request(app).post("/api/notes").send({ text: " retention is\na cohort question ", dest: "learn.md" });
    expect(res.status).toBe(201);
    expect(res.body.note).toEqual({ dest: "learn.md", created: false });
    expect(v.text("obsidian", "learn.md")).toBe("# Learn\nx\n- retention is\n  a cohort question\n");
    expect(v.docs["obsidian/h:old"].data).toBe("# Learn\nx");
    expect(v.docs["obsidian/learn.md"]._rev).toBe("2-x");
    expect(v.docs["obsidian/learn.md"].ctime).toBe(5);
    expect(v.docs["obsidian/learn.md"].size).toBe(9 + Buffer.byteLength("\n- retention is\n  a cohort question\n"));
  });

  const ROOTED: Doc[] = [
    ...DOCS.filter((d) => d._id !== "course:analytics"),
    { _id: "course:analytics", type: "course", slug: "analytics", title: "Analytics", vaultRoot: "projects/sokrates/wiki/analytics/" },
    { _id: "project:platform-axiology", type: "project", slug: "platform-axiology", title: "Platform Axiology", root: "work/platform/projects/platform axiology", files: {} },
    { _id: "project:nova-trap", type: "project", slug: "nova-trap", title: "Trap", root: "projects/sokrates/projects/nova", files: {} },
  ];

  it("lists each project's and course's own notes.md, then the Inbox and learn.md, and never a Nova folder", async () => {
    const res = await request(createApp(makeStub([...ROOTED]), makeAgora(), memVault().store)).get("/api/notes/dests");
    expect(res.status).toBe(200);
    expect(res.body.dests).toEqual([
      { kind: "project", slug: "platform-axiology", label: "Platform Axiology", path: "work/platform/projects/platform axiology/notes.md" },
      { kind: "course", slug: "analytics", label: "Analytics", path: "projects/sokrates/wiki/analytics/notes.md" },
      { kind: "inbox", label: "Inbox", path: "projects/sokrates/projects/lyceum/inbox.md" },
      { kind: "learn", label: "Want to learn", path: "learn.md" },
    ]);
  });

  it("creates a missing file at a listed destination", async () => {
    const v = memVault();
    const app = createApp(makeStub([...ROOTED]), makeAgora(), v.store);
    expect((await request(app).post("/api/notes").send({ text: "a", dest: "projects/sokrates/wiki/analytics/notes.md" })).status).toBe(201);
    expect(v.text("obsidian", "projects/sokrates/wiki/analytics/notes.md")).toBe("- a\n");
    expect((await request(app).post("/api/notes").send({ text: "b", dest: "projects/sokrates/projects/lyceum/inbox.md" })).status).toBe(201);
    expect(v.text("obsidian", "projects/sokrates/projects/lyceum/inbox.md")).toBe("- b\n");
  });

  it("refuses an empty note, Nova's instruction inbox, raw/, and any path it did not list, and writes nothing", async () => {
    const v = memVault();
    const app = createApp(makeStub([...ROOTED]), makeAgora(), v.store);
    expect((await request(app).post("/api/notes").send({ text: "   ", dest: "learn.md" })).status).toBe(400);
    expect((await request(app).post("/api/notes").send({ text: "x", dest: "projects/sokrates/projects/nova/notes.md" })).status).toBe(400);
    expect((await request(app).post("/api/notes").send({ text: "x", dest: "projects/sokrates/wiki/analytics/raw/notes.md" })).status).toBe(400);
    expect((await request(app).post("/api/notes").send({ text: "x", dest: "notes.md" })).status).toBe(400);
    expect((await request(app).post("/api/notes").send({ text: "x" })).status).toBe(400);
    expect(v.docs).toEqual({});
  });

  it("keys a mixed-case path by its lowercased id, as LiveSync does, and keeps the casing in path", async () => {
    const v = memVault({
      "obsidian/work/inbox.md": { _id: "work/inbox.md", path: "Work/Inbox.md", _rev: "1-a", children: ["h:old"], size: 4, ctime: 5, type: "plain" },
      "obsidian/h:old": { _id: "h:old", data: "# In\n", type: "leaf" },
    });
    const { created } = await appendNote(v.store, "Work/Inbox.md", "a thought");
    expect(created).toBe(false);
    expect(v.docs["obsidian/Work/Inbox.md"]).toBeUndefined();
    expect(v.docs["obsidian/work/inbox.md"].path).toBe("Work/Inbox.md");
    expect(v.text("obsidian", "work/inbox.md")).toBe("# In\n- a thought\n");
  });

  /* Issue #277, the data-loss half. An append is a read-modify-write: read the
   * file document, add one chunk, put it back with the `_rev` we read. If
   * Obsidian syncs the same file in between, CouchDB refuses with 409 -- and
   * before this, that 409 became a 502 and the note he had typed was gone,
   * while its chunk sat orphaned in the database. */
  function racingVault(conflicts: number, seed: Record<string, Record<string, any>>) {
    const v = memVault(seed);
    let left = conflicts;
    const inner = v.store.put;
    const puts: string[] = [];
    v.store.put = async (db, doc) => {
      puts.push(String(doc._id));
      if (!String(doc._id).startsWith("h:") && left > 0) {
        left--;
        // What Obsidian's own sync did while we were reading: his text grew,
        // and the revision we hold is stale.
        v.docs[`${db}/${doc._id}`] = {
          ...v.docs[`${db}/${doc._id}`],
          _rev: `9-his${left}`,
          children: [...(v.docs[`${db}/${doc._id}`].children as string[]), "h:his"],
        };
        v.docs[`${db}/h:his`] = { _id: "h:his", data: "- something he wrote\n", type: "leaf" };
        throw new VaultConflict("vault 409 writing " + doc._id);
      }
      return inner(db, doc);
    };
    return { ...v, puts };
  }

  const NOTE_FILE = {
    "obsidian/learn.md": { _id: "learn.md", _rev: "1-a", children: ["h:old"], size: 5, ctime: 5, type: "plain" },
    "obsidian/h:old": { _id: "h:old", data: "# In\n", type: "leaf" },
  };

  it("re-reads and retries when the file moved under it, keeping both his text and the note", async () => {
    const v = racingVault(1, structuredClone(NOTE_FILE));
    const app = createApp(makeStub(), makeAgora(), v.store);
    expect((await request(app).post("/api/notes").send({ text: "mine", dest: "learn.md" })).status).toBe(201);
    // The retry re-read, so the revision he wrote is still there and the note
    // landed after it rather than over it.
    expect(v.text("obsidian", "learn.md")).toBe("# In\n- something he wrote\n- mine\n");
  });

  it("gives up rather than looping forever, and says the file is in conflict", async () => {
    const v = racingVault(99, structuredClone(NOTE_FILE));
    const app = createApp(makeStub(), makeAgora(), v.store);
    expect((await request(app).post("/api/notes").send({ text: "mine", dest: "learn.md" })).status).toBe(502);
    // Four attempts at the file document, and no more.
    expect(v.puts.filter((id) => !id.startsWith("h:")).length).toBe(4);
  });

  /* The two tests above drive an in-memory store, so they cannot see which
   * HTTP status becomes a conflict. That decision lives in `httpVault.put`
   * and is tested against it, with `fetch` stubbed -- otherwise "a chunk 409
   * is not a conflict" is a claim nothing checks. */
  describe("httpVault.put", () => {
    function withFetch(status: number, run: () => Promise<unknown>) {
      const real = globalThis.fetch;
      const calls: RequestInit[] = [];
      globalThis.fetch = (async (_url: any, init: RequestInit) => {
        calls.push(init);
        return { status, ok: status < 300, json: async () => ({}) } as any;
      }) as any;
      process.env.COUCHDB_URL = "http://couch.invalid";
      return run().finally(() => { globalThis.fetch = real; }).then(
        (v) => ({ calls, value: v, error: undefined as unknown }),
        (error) => ({ calls, value: undefined, error }),
      );
    }

    it("treats a 409 on a chunk as already written, and a 409 on a file as a conflict", async () => {
      const chunk = await withFetch(409, () => httpVault.put("obsidian", { _id: "h:abc", data: "x" }));
      expect(chunk.error).toBeUndefined();
      const file = await withFetch(409, () => httpVault.put("obsidian", { _id: "learn.md", children: [] }));
      expect(file.error).toBeInstanceOf(VaultConflict);
    });

    it("gives every call a deadline, so a database that stops answering cannot hang the request", async () => {
      const put = await withFetch(201, () => httpVault.put("obsidian", { _id: "learn.md", children: [] }));
      expect(put.calls[0].signal).toBeInstanceOf(AbortSignal);
      const get = await withFetch(200, () => httpVault.get("obsidian", "learn.md"));
      expect(get.calls[0].signal).toBeInstanceOf(AbortSignal);
    });
  });

  it("will not append to a file whose last chunk is missing", async () => {
    const v = memVault({ "obsidian/learn.md": { _id: "learn.md", _rev: "1-a", children: ["h:gone"], type: "plain" } });
    const app = createApp(makeStub(), makeAgora(), v.store);
    expect((await request(app).post("/api/notes").send({ text: "x", dest: "learn.md" })).status).toBe(502);
    expect(v.docs["obsidian/learn.md"]._rev).toBe("1-a");
  });
});

describe("basisOf", () => {
  it("says a wiki course was built by a cycle, from how many raw files, and where", () => {
    const course = { generatedBy: "llm_wiki", generated: "2026-09-20 11:30", vaultRoot: "projects/sokrates/wiki/analytics/" };
    expect(basisOf(course, 24, 9)).toBe(
      "Built by a Nova cycle on 2026-09-20 from 24 researched source files in projects/sokrates/wiki/analytics/raw/. The wiki pages are the chapters; the raw/ files are the sources behind them.",
    );
  });

  it("does not call a hand-written course generated", () => {
    const course = { generatedBy: null, generated: null, vaultRoot: "work/platform/learn/a9s/" };
    const basis = basisOf(course, 1, 3);
    expect(basis).toBe("Hand-written in work/platform/learn/a9s/, not generated: 3 chapters and 1 source file, read as they are.");
    expect(basis).not.toContain("Built by");
  });
});

describe("workshop", () => {
  const project: Doc = {
    _id: "project:axiology",
    type: "project",
    slug: "axiology",
    title: "Platform Axiology",
    stage: "demo",
    line: "Rank capabilities by developer value.",
    root: "work/platform/projects/platform axiology",
    files: {
      "initials/philos.md": "problem",
      "ui/tension-explorer.jsx": "demo",
      "workshop/workshop.md": "demo",
      "ui/tool.jsx": "demo",
      "workshop/questions.pptx": "evaluation",
    },
  };
  const vaultDocs: Record<string, Record<string, any>> = {
    "obsidian/work/platform/projects/platform axiology/workshop/workshop.md": { children: ["h:a", "h:b"] },
    "obsidian/h:a": { data: "# Work" },
    "obsidian/h:b": { data: "shop\n" },
    "obsidian/work/platform/projects/platform axiology/initials/philos.md": { data: "inline text", children: [] },
    "obsidian/work/platform/projects/platform axiology/secret.md": { data: "not listed" },
    "obsidian/work/platform/projects/platform axiology/ui/tool.jsx": { type: "newnote", children: ["h:c"] },
    "obsidian/h:c": { data: Buffer.from("export const x = 1;\n").toString("base64") },
    "obsidian/work/platform/projects/platform axiology/workshop/questions.pptx": { type: "newnote", data: "UEsDBA==", children: [] },
  };
  const store: VaultStore = {
    async get(db, id) { return vaultDocs[`${db}/${id}`] ?? null; },
    async put() { throw new Error("the workshop never writes"); },
  };
  const app = createApp(makeStub([...DOCS, project]), makeAgora(), store);

  it("lists projects as cards", async () => {
    const res = await request(app).get("/api/workshop");
    expect(res.status).toBe(200);
    expect(res.body.projects).toEqual([
      { slug: "axiology", title: "Platform Axiology", stage: "demo", line: "Rank capabilities by developer value.", fileCount: 5 },
    ]);
  });

  it("places each file in its stage, all six stages present, name without .md", async () => {
    const res = await request(app).get("/api/workshop/axiology");
    expect(res.status).toBe(200);
    const stages = res.body.project.stages;
    expect(stages.map((s: any) => s.stage)).toEqual(["problem", "objectives", "design", "demo", "evaluation", "communication"]);
    expect(stages[0].files).toEqual([{ path: "initials/philos.md", name: "philos", ext: "md" }]);
    expect(stages[3].files).toEqual([
      { path: "ui/tension-explorer.jsx", name: "tension-explorer.jsx", ext: "jsx" },
      { path: "workshop/workshop.md", name: "workshop", ext: "md" },
      { path: "ui/tool.jsx", name: "tool.jsx", ext: "jsx" },
    ]);
    expect(stages[5].files).toEqual([]);
  });

  it("reads a listed file from its chunks or its inline data", async () => {
    const chunked = await request(app).get("/api/workshop/axiology/file").query({ path: "workshop/workshop.md" });
    expect(chunked.status).toBe(200);
    expect(chunked.body.file.text).toBe("# Workshop\n");
    const inline = await request(app).get("/api/workshop/axiology/file").query({ path: "initials/philos.md" });
    expect(inline.body.file.text).toBe("inline text");
  });

  it("decodes a base64 text file and refuses a binary one", async () => {
    const jsx = await request(app).get("/api/workshop/axiology/file").query({ path: "ui/tool.jsx" });
    expect(jsx.body.file.text).toBe("export const x = 1;\n");
    const pptx = await request(app).get("/api/workshop/axiology/file").query({ path: "workshop/questions.pptx" });
    expect(pptx.status).toBe(415);
  });

  it("refuses a path the project does not list, even one that exists in the vault", async () => {
    for (const path of ["secret.md", "../secret.md", "workshop/../secret.md"]) {
      const res = await request(app).get("/api/workshop/axiology/file").query({ path });
      expect(res.status).toBe(404);
    }
  });

  it("404s an unknown project", async () => {
    expect((await request(app).get("/api/workshop/nope")).status).toBe(404);
  });

  it("lists a discussion opened at a stage under that stage, with its message count", async () => {
    const bench = createApp(makeStub([...DOCS, project]), makeAgora(), store);
    const made = await request(bench).post("/api/discussions")
      .send({ title: "Falsify · Platform Axiology", workshop: { project: "axiology", stage: "evaluation" } });
    expect(made.status).toBe(201);
    expect(made.body.discussion.stage).toBe("evaluation");
    // A plain thread is not a workshop discussion and must not appear on the bench.
    await request(bench).post("/api/discussions").send({ title: "OKRs" });

    const stages = (await request(bench).get("/api/workshop/axiology")).body.project.stages;
    expect(stages[4].discussions).toEqual([
      { id: made.body.discussion.id, title: "Falsify · Platform Axiology", createdAt: expect.any(String), messages: 2 },
    ]);
    expect(stages.filter((s: any) => s.discussions.length).length).toBe(1);

    const list = (await request(bench).get("/api/discussions")).body.discussions;
    expect(list.find((d: Doc) => d.title === "OKRs").scope).toBe("global");
    expect(list.find((d: Doc) => d.title !== "OKRs").scope).toBe("workshop");
  });

  it("starts a workshop project at stage 1 with the thread it was started in", async () => {
    const couch = makeStub([...DOCS, project]);
    const bench = createApp(couch, makeAgora(), store);
    const made = await request(bench).post("/api/workshop").send({});
    expect(made.status).toBe(201);
    const slug = made.body.project.slug;
    expect(slug).toMatch(/^untitled-/);
    expect(made.body.discussion.opened).toBe("Workshop project · stage 1, Problem identification");

    // It is a real project: listed, empty, at the first stage, with its own folder.
    const cards = (await request(bench).get("/api/workshop")).body.projects;
    expect(cards.find((c: any) => c.slug === slug)).toEqual({ slug, title: "Untitled project", stage: "problem", line: "", fileCount: 0 });
    expect((await couch.get(`project:${slug}`))!.root).toBe(`work/workshop/${slug}`);

    // Its thread is filed under stage 1 on the bench, and opening it shows the Created card.
    const stages = (await request(bench).get(`/api/workshop/${slug}`)).body.project.stages;
    expect(stages[0].discussions.map((d: any) => d.id)).toEqual([made.body.discussion.id]);
    const thread = await request(bench).get(`/api/discussions/${encodeURIComponent(made.body.discussion.id)}/messages`);
    expect(thread.body.discussion.opened).toBe("Workshop project · stage 1, Problem identification");
    expect(thread.body.discussion.project).toBe(slug);
  });

  it("opens Discuss from a project page as a workshop discussion that knows its project", async () => {
    const sent: { id: string; text: string; sender?: string }[] = [];
    const bench = createApp(makeStub([...DOCS, project]), makeAgora(sent), store);
    const about = { kind: "project", text: "Platform Axiology", where: "demonstration" };
    const made = await request(bench).post("/api/discussions")
      .send({ title: "Platform Axiology", about, workshop: { project: "axiology", stage: "demo" } });
    expect(made.status).toBe(201);
    expect(made.body.discussion.about).toEqual(about);

    const stages = (await request(bench).get("/api/workshop/axiology")).body.project.stages;
    expect(stages[3].discussions.map((d: Doc) => d.id)).toEqual([made.body.discussion.id]);

    await request(bench).post(`/api/discussions/${made.body.discussion.id}/messages`).send({ text: "is value circular?" });
    expect(sent[0].text).toContain('from his workshop project "Platform Axiology", looking at its demonstration stage');
    expect(sent[1]).toMatchObject({ sender: "Edvard", text: "is value circular?" });
  });

  it("saves a tool's output as a new vault file in the project folder, listed at its stage", async () => {
    const written: Record<string, Record<string, any>> = {};
    const w: VaultStore = {
      async get(db, id) { return written[`${db}/${id}`] ?? vaultDocs[`${db}/${id}`] ?? null; },
      async put(db, doc) { written[`${db}/${doc._id}`] = doc; },
    };
    const docs = [...DOCS, { ...project, files: { ...project.files } }];
    const bench = createApp(makeStub(docs), makeAgora(), w);
    const res = await request(bench).post("/api/workshop/axiology/files")
      .send({ tool: "Falsify / test", stage: "evaluation", text: "- claim one\n- claim two" });
    expect(res.status).toBe(201);
    const rel = res.body.file.path;
    expect(rel).toMatch(/^workshop\/Falsify test \d{4}-\d{2}-\d{2} \d{4}\.md$/);
    const file = written[`obsidian/work/platform/projects/platform axiology/${rel.toLowerCase()}`];
    expect(file.path).toBe(`work/platform/projects/platform axiology/${rel}`);
    expect(file.type).toBe("plain");
    expect(file.children).toHaveLength(1);
    expect(written[`obsidian/${file.children[0]}`].data).toBe(
      "# Falsify test · Platform Axiology\n\nStage: evaluation · saved from the Workshop · Aristoteles\n\n- claim one\n- claim two\n",
    );
    const stages = (await request(bench).get("/api/workshop/axiology")).body.project.stages;
    expect(stages[4].files.map((f: any) => f.path)).toContain(rel);
    // The saved file reads back through the project, like any file of it.
    const back = await request(bench).get("/api/workshop/axiology/file").query({ path: rel });
    expect(back.body.file.text).toContain("- claim two");

    // A second save in the same minute gets a number rather than overwriting.
    const again = await request(bench).post("/api/workshop/axiology/files").send({ tool: "Falsify / test", stage: "evaluation", text: "other" });
    expect(again.status).toBe(201);
    expect(again.body.file.path).toBe(rel.replace(/\.md$/, " 2.md"));
  });

  it("never overwrites a vault file the project does not list", async () => {
    const taken: Record<string, Record<string, any>> = {};
    let stamp = "";
    const w: VaultStore = {
      async get(db, id) {
        if (id.includes("/workshop/lens ") && !id.endsWith(" 2.md") && !(`${db}/${id}` in taken)) {
          stamp = id; return { _id: id, data: "his own text" };
        }
        return taken[`${db}/${id}`] ?? null;
      },
      async put(db, doc) { taken[`${db}/${doc._id}`] = doc; },
    };
    const bench = createApp(makeStub([...DOCS, { ...project, files: { ...project.files } }]), makeAgora(), w);
    const res = await request(bench).post("/api/workshop/axiology/files").send({ tool: "Lens", stage: "design", text: "x" });
    expect(res.status).toBe(201);
    expect(res.body.file.path).toMatch(/ 2\.md$/);
    expect(`obsidian/${stamp}` in taken).toBe(false);
  });

  it("refuses a save with no text, no tool, a bad stage or an unknown project", async () => {
    const bench = createApp(makeStub([...DOCS, project]), makeAgora(), store);
    const post = (slug: string, body: object) => request(bench).post(`/api/workshop/${slug}/files`).send(body);
    expect((await post("axiology", { tool: "Lens", stage: "design", text: " " })).status).toBe(400);
    expect((await post("axiology", { stage: "design", text: "x" })).status).toBe(400);
    expect((await post("axiology", { tool: "Lens", stage: "done", text: "x" })).status).toBe(400);
    expect((await post("nope", { tool: "Lens", stage: "design", text: "x" })).status).toBe(404);
  });

  it("refuses a workshop discussion at no stage or on no project, before Agora is asked", async () => {
    const made: string[] = [];
    const agora: Agora = { ...makeAgora(), async createConversation(n) { made.push(n); return "c"; } };
    const bench = createApp(makeStub([...DOCS, project]), agora, store);
    const bad = await request(bench).post("/api/discussions").send({ title: "x", workshop: { project: "axiology", stage: "done" } });
    expect(bad.status).toBe(400);
    const none = await request(bench).post("/api/discussions").send({ title: "x", workshop: { project: "nope", stage: "problem" } });
    expect(none.status).toBe(404);
    expect(made).toEqual([]);
  });

  it("answers 502 rather than crashing when the project lookup throws", async () => {
    const down: Couch = { ...makeStub([...DOCS, project]), async get() { throw new Error("couch down"); } };
    const res = await request(createApp(down, makeAgora(), store)).post("/api/discussions").send({ title: "x", workshop: { project: "axiology", stage: "problem" } });
    expect(res.status).toBe(502);
  });

  it("keeps the page when one transcript cannot be counted", async () => {
    const agora: Agora = { ...makeAgora(), async messages() { throw new Error("Agora 500"); } };
    const bench = createApp(makeStub([...DOCS, project]), agora, store);
    await request(bench).post("/api/discussions").send({ title: "t", workshop: { project: "axiology", stage: "problem" } });
    const res = await request(bench).get("/api/workshop/axiology");
    expect(res.status).toBe(200);
    expect(res.body.project.stages[0].discussions[0].messages).toBeNull();
  });
});

/** Issue #270: a claim's conversation is saved against the claim, so "Ask
 * about this" reopens it and the mark carries a badge.
 *
 * The failure this guards is not a crash -- it is a second thread. Before
 * this, every tap of "Ask about this" on the same claim created another
 * conversation, and nothing on the page said one already existed, so the
 * only way to find yesterday's answer was to go looking in the Aristoteles
 * tab for a thread titled with the first 80 characters of the claim. */
describe("a claim keeps its own conversation", () => {
  const CLAIM = "claim:analytics:b-second:000";

  it("stores the claim id it was opened from, and only for a claim", async () => {
    const docs = [...DOCS];
    const chat = createApp(makeStub(docs), makeAgora());
    const made = await request(chat)
      .post("/api/discussions")
      .send({ title: "two is the paragraph", about: { kind: "claim", text: "two is the paragraph this claim belongs under", claimId: CLAIM } });
    expect(made.status).toBe(201);
    expect(made.body.discussion.about.claimId).toBe(CLAIM);

    // A chapter thread carries no claim id even when one is posted: it is not
    // a claim, so nothing should ever find it by claim.
    const chapter = await request(chat)
      .post("/api/discussions")
      .send({ title: "Second", about: { kind: "chapter", text: "Second", claimId: CLAIM } });
    expect(chapter.status).toBe(201);
    expect(chapter.body.discussion.about.claimId).toBeUndefined();
  });

  it("hands the chapter the thread and its message count, and null for a claim with none", async () => {
    const docs = [...DOCS];
    const chat = createApp(makeStub(docs), makeAgora());
    const made = await request(chat)
      .post("/api/discussions")
      .send({ title: "two is the paragraph", about: { kind: "claim", text: "two is the paragraph this claim belongs under", claimId: CLAIM } });
    // Reading the thread is what settles the count -- Agora holds the
    // transcript and the chapter route never asks it.
    await request(chat).get(`/api/discussions/${made.body.discussion.id}/messages`);

    const res = await request(chat).get("/api/chapters/chapter:analytics:b-second");
    expect(res.status).toBe(200);
    const talked = res.body.claims.find((c: any) => c.id === CLAIM);
    expect(talked.discussion).toEqual({ id: made.body.discussion.id, messageCount: 2 });
    // Every other claim in the same chapter is untouched. Without this, a
    // badge on all of them would read exactly like a badge on the right one.
    for (const c of res.body.claims) {
      if (c.id !== CLAIM) expect(c.discussion).toBeNull();
    }
  });

  it("does not write the count back when it has not moved", async () => {
    const docs = [...DOCS];
    const puts: string[] = [];
    const base = makeStub(docs);
    const counting = { ...base, async put(doc: Doc) { puts.push(doc._id); return base.put(doc); } };
    const chat = createApp(counting, makeAgora());
    const made = await request(chat)
      .post("/api/discussions")
      .send({ title: "two is the paragraph", about: { kind: "claim", text: "two is the paragraph this claim belongs under", claimId: CLAIM } });
    const id = made.body.discussion.id;
    await request(chat).get(`/api/discussions/${id}/messages`);
    const afterFirst = puts.filter((p) => p === id).length;
    await request(chat).get(`/api/discussions/${id}/messages`);
    await request(chat).get(`/api/discussions/${id}/messages`);
    // The thread is polled every 3 seconds while a reply is coming. A put per
    // poll would be a write loop for a number that did not change.
    expect(puts.filter((p) => p === id).length).toBe(afterFirst);
  });
});
