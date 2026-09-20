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

const stub: Couch = {
  async allDocs(prefix) {
    return DOCS.filter((d) => d._id.startsWith(prefix));
  },
  async get(id) {
    return DOCS.find((d) => d._id === id) ?? null;
  },
};

const app = createApp(stub);

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
    });
    const res = await request(broken).get("/api/courses");
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("401");
  });

  it("answers /healthz without touching the database", async () => {
    const res = await request(createApp({
      async allDocs() { throw new Error("must not be called"); },
      async get() { throw new Error("must not be called"); },
    })).get("/healthz");
    expect(res.status).toBe(200);
  });
});
