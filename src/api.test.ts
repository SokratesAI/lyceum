/** Tests for the shell's read API, against a stub CouchDB.
 *
 * The stub is deliberately literal about the shapes `tools.lyceum_import`
 * writes -- prefixed ids, `chapterIds`/`sourceIds` on the course, `order` on a
 * chapter -- because a test written against a shape the importer does not
 * produce would pass against nothing real.
 */
import type { VaultStore } from "./vault.js";
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
  reply?: { sender: string; text: string; ts: string | null }[],
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
    // The briefing is also on this wire, from a different sender; his message
    // is the only one attributed to him.
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe("conv-for-Lyceum — OKRs");
    // His words are there, with the memory index riding in front of them.
    expect(sent[0].text).toContain("what is a KPI");
    expect(sent[0].text).toContain("<context>");
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
    expect(sent[0].text).toMatch(/why\?$/);
    expect(sent[1].text).toBe("and then?");
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
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("- OKRs — his framework");
    // The index and not the bodies: that is the whole point of an index.
    expect(sent[0].text).not.toContain("the long body");

    await request(chat).post(`/api/discussions/${id}/messages`).send({ text: "second" });
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toBe("second");
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
    // Inside a context block, so it never renders as a bubble.
    expect(stripMarkers(answers[0].text)).toBe("");
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
      ]),
    );
    const made = await request(chat).post("/api/discussions").send({ title: "OKRs" });
    const read = await request(chat).get(`/api/discussions/${made.body.discussion.id}/messages`);
    expect(read.body.messages.map((m: Doc) => m.text)).toEqual(["hello", "hello back"]);
    // The recall answer is his message on the wire, so a reply is coming and
    // the page must keep polling even though the newest bubble is Aristoteles.
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

  it("creates a missing file, and routes Nova's folder to Nova's database", async () => {
    const v = memVault();
    const app = createApp(makeStub(), makeAgora(), v.store);
    await request(app).post("/api/notes").send({ text: "a", dest: "work/platform/projects/platform atlas/notes.md" });
    expect(v.text("obsidian", "work/platform/projects/platform atlas/notes.md")).toBe("- a\n");
    await request(app).post("/api/notes").send({ text: "b", dest: "projects/sokrates/projects/nova/notes.md" });
    expect(v.text("nova", "projects/sokrates/projects/nova/notes.md")).toBe("- b\n");
    expect(v.docs["obsidian/projects/sokrates/projects/nova/notes.md"]).toBeUndefined();
  });

  it("refuses an empty note and any file that is not one of the demo's chips, and writes nothing", async () => {
    const v = memVault();
    const app = createApp(makeStub(), makeAgora(), v.store);
    expect((await request(app).post("/api/notes").send({ text: "   ", dest: "notes.md" })).status).toBe(400);
    expect((await request(app).post("/api/notes").send({ text: "x", dest: "journal.md" })).status).toBe(400);
    expect((await request(app).post("/api/notes").send({ text: "x" })).status).toBe(400);
    expect(v.docs).toEqual({});
  });

  it("will not append to a file whose last chunk is missing", async () => {
    const v = memVault({ "obsidian/notes.md": { _id: "notes.md", _rev: "1-a", children: ["h:gone"], type: "plain" } });
    const app = createApp(makeStub(), makeAgora(), v.store);
    expect((await request(app).post("/api/notes").send({ text: "x", dest: "notes.md" })).status).toBe(502);
    expect(v.docs["obsidian/notes.md"]._rev).toBe("1-a");
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
