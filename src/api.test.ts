/** Tests for the shell's read API, against a stub CouchDB.
 *
 * The stub is deliberately literal about the shapes `tools.lyceum_import`
 * writes -- prefixed ids, `chapterIds`/`sourceIds` on the course, `order` on a
 * chapter -- because a test written against a shape the importer does not
 * produce would pass against nothing real.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import type { Couch, Doc } from "./couch.js";
import { NoToken, visibleMessages, type Agora } from "./agora.js";

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
    body: "one\n\ntwo",
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
  async get(id) {
    return docs.find((d) => d._id === id) ?? null;
  },
  async put(doc) {
    docs.push(doc);
    return { ...doc, _rev: "1-stub" };
  },
});

const makeAgora = (sent: { id: string; text: string }[] = []): Agora => ({
  async createConversation(name) {
    return `conv-for-${name}`;
  },
  async postMessage(conversationId, text) {
    sent.push({ id: conversationId, text });
    return "msg-1";
  },
  async messages() {
    return [
      { sender: "Edvard", text: "what is a KPI", ts: "2026-09-20T22:00:00Z" },
      { sender: "Aristoteles", text: "a measure you act on", ts: "2026-09-20T22:00:05Z" },
    ];
  },
});

const stub = makeStub();
const app = createApp(stub, makeAgora());

describe("GET /api/courses", () => {
  it("counts chapters and sources without shipping their bodies", async () => {
    const res = await request(app).get("/api/courses");
    expect(res.status).toBe(200);
    expect(res.body.courses).toEqual([
      { slug: "analytics", title: "Analytics", chapterCount: 2, sourceCount: 1 },
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
    const sent: { id: string; text: string }[] = [];
    const fresh = makeStub([...DOCS]);
    const chat = createApp(fresh, makeAgora(sent));
    const made = await request(chat).post("/api/discussions").send({ title: "OKRs" });

    const res = await request(chat)
      .post(`/api/discussions/${made.body.discussion.id}/messages`)
      .send({ text: "what is a KPI" });
    expect(res.status).toBe(201);
    expect(sent).toEqual([{ id: "conv-for-Lyceum — OKRs", text: "what is a KPI" }]);
  });

  it("refuses an empty message rather than posting a blank one", async () => {
    const sent: { id: string; text: string }[] = [];
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
