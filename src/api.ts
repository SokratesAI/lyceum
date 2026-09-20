/** The read-only API the PWA shell runs on -- build step 4.
 *
 * Three routes, one per screen the shell has: the course list, one course with
 * its chapters and sources, and one chapter's body. They return only what the
 * screen renders, so a course list does not ship six chapter bodies to a phone.
 */
import express, { type Router } from "express";
import type { Couch, Doc } from "./couch.js";
import { OWNER, personaId, type Agora } from "./agora.js";
import { briefing, contextBlock, parseMemories, parseRecalls, stripMarkers, upsert } from "./memory.js";

const byOrder = (a: Doc, b: Doc) => (a.order ?? 0) - (b.order ?? 0);

/** A discussion's own id. Random rather than derived from the title: two
 *  threads about the same thing are two threads, and a title can be edited. */
const discussionId = () => `discussion:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const MAX_TEXT = 8000;
const THREAD_LIMIT = 200;

/** Read Aristoteles's markers out of a thread and act on them.
 *
 * Runs on the read path because that is the only moment this app learns a
 * reply exists -- Agora pushes nothing here, and the page polls. It is
 * therefore re-run on every poll, which is why writing is an upsert by slug
 * and why a recall is answered only when the recall is the newest message:
 * both make a second pass over the same reply a no-op rather than a duplicate.
 *
 * The second guard is the one that bounds cost. Answering a recall posts an
 * owner message, which starts another model turn, which can contain another
 * recall -- so a memory whose body is already somewhere in the transcript is
 * not posted again. Aristoteles can still ask for something he has not been
 * given; he cannot make the app and himself talk to each other forever.
 */
async function harvest(
  couch: Couch,
  agora: Agora,
  doc: Doc,
  rows: { sender: string; text: string }[],
) {
  const last = rows[rows.length - 1];
  if (!last || last.sender === OWNER) return;

  for (const file of parseMemories(last.text)) {
    await upsert(couch, file, doc._id);
  }

  const transcript = rows.map((r) => r.text).join("\n");
  for (const id of parseRecalls(last.text)) {
    const mem = await couch.get(`memory:${id}`);
    if (mem && transcript.includes(mem.body)) continue;
    const text = mem
      ? `Memory "${mem.name}":\n\n${mem.body}`
      : `No memory named "${id}" -- nothing has been written under that name.`;
    await agora.postMessage(doc.conversationId, contextBlock(text));
  }
}

export function apiRouter(couch: Couch, agora: Agora): Router {
  const router = express.Router();

  router.get("/courses", async (_req, res, next) => {
    try {
      const docs = await couch.allDocs("course:");
      res.json({
        courses: docs.map((d) => ({
          slug: d.slug,
          title: d.title,
          chapterCount: (d.chapterIds ?? []).length,
          sourceCount: (d.sourceIds ?? []).length,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/courses/:slug", async (req, res, next) => {
    try {
      const course = await couch.get(`course:${req.params.slug}`);
      if (!course) return res.status(404).json({ error: "no such course" });
      const chapters = await couch.allDocs(`chapter:${req.params.slug}:`);
      const sources = await couch.allDocs(`source:${req.params.slug}:`);
      res.json({
        course: { slug: course.slug, title: course.title, spine: course.spine },
        chapters: chapters
          .sort(byOrder)
          .map((c) => ({ id: c._id, slug: c.slug, title: c.title })),
        sources: sources.map((s) => ({
          id: s._id,
          slug: s.slug,
          title: s.title,
          url: s.url ?? null,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get("/chapters/:id", async (req, res, next) => {
    try {
      const doc = await couch.get(req.params.id);
      if (!doc || doc.type !== "chapter") {
        return res.status(404).json({ error: "no such chapter" });
      }
      res.json({
        chapter: {
          id: doc._id,
          title: doc.title,
          body: doc.body,
          courseId: doc.courseId,
          sourceIds: doc.sourceIds ?? [],
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /** The global Aristoteles tab: one row per topic thread, newest first.
   *
   * Per-topic threads are the spec's shape for this tab -- "in those chats I
   * ask Ari to create a new workshop for me or create a new course" -- so the
   * list is the entry point, not a single endless conversation. Workshop
   * discussions (build step 10) are the same document with a `projectId` and
   * a `stage` on it, which is why `scope` is stored from the first write
   * rather than inferred later.
   */
  router.get("/discussions", async (_req, res, next) => {
    try {
      const docs = await couch.allDocs("discussion:");
      res.json({
        discussions: docs
          .map((d) => ({
            id: d._id,
            title: d.title,
            scope: d.scope ?? "global",
            conversationId: d.conversationId,
            createdAt: d.createdAt ?? null,
          }))
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      });
    } catch (err) {
      next(err);
    }
  });

  /** Start a topic thread. Agora first, then the row.
   *
   * Order matters and this is the honest one: a row written before the
   * conversation exists points at nothing, and a conversation created without
   * its row is invisible in the app but still readable in Agora. The first
   * failure is a broken thread in the list; the second is an orphan the owner
   * can still find. Prefer the recoverable one.
   */
  router.post("/discussions", async (req, res, next) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    if (!title) return res.status(400).json({ error: "a discussion needs a title" });
    if (title.length > 200) return res.status(400).json({ error: "that title is too long" });
    try {
      const conversationId = await agora.createConversation(`Lyceum — ${title}`);
      const doc = await couch.put({
        _id: discussionId(),
        type: "discussion",
        title,
        scope: "global",
        conversationId,
        personaId: personaId(),
        createdAt: new Date().toISOString(),
      });
      res.status(201).json({ discussion: { id: doc._id, title, conversationId } });
    } catch (err) {
      next(err);
    }
  });

  /** The messages in one discussion, straight out of Agora.
   *
   * Nothing is cached here. Agora holds the only copy of a transcript and it
   * grows while the model writes, so a copy in this database would be stale
   * the moment Aristoteles answered.
   */
  router.get("/discussions/:id/messages", async (req, res, next) => {
    try {
      const doc = await couch.get(req.params.id);
      if (!doc || doc.type !== "discussion") {
        return res.status(404).json({ error: "no such discussion" });
      }
      const raw = await agora.messages(doc.conversationId, THREAD_LIMIT);
      await harvest(couch, agora, doc, raw);
      // Everything the app said to Aristoteles is inside a `<context>` block
      // in an owner message; stripping it leaves an empty string, and an empty
      // message is not a bubble. That is what keeps the machinery off his
      // screen without a second sender -- which Agora records but the model
      // never reads.
      const messages = raw
        .map((m) => ({ ...m, text: stripMarkers(m.text) }))
        .filter((m) => m.text);
      // `waiting` is `nova_conversations.thread`'s flag and means the same
      // thing: the last message is his, so a reply is still coming and the
      // page should keep polling rather than settle. It is read off the raw
      // rows, not the rendered ones -- a recall answer is an owner message
      // that renders as nothing, and judging by the visible list would settle
      // the page while a reply was on its way, leaving the answer unseen
      // until a reload.
      const last = raw[raw.length - 1];
      res.json({
        discussion: { id: doc._id, title: doc.title },
        messages,
        waiting: Boolean(last && last.sender === OWNER),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/discussions/:id/messages", async (req, res, next) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "a message needs some text" });
    if (text.length > MAX_TEXT) {
      return res.status(400).json({ error: `that is longer than ${MAX_TEXT} characters` });
    }
    try {
      const doc = await couch.get(req.params.id);
      if (!doc || doc.type !== "discussion") {
        return res.status(404).json({ error: "no such discussion" });
      }
      // The index rides on his first message rather than going in as its own
      // turn: one model call instead of two, and no bubble to hide.
      let outgoing = text;
      if (!doc.briefed) {
        outgoing = `${contextBlock(briefing(await couch.allDocs("memory:")))}\n\n${text}`;
        await couch.put({ ...doc, briefed: true });
      }
      const id = await agora.postMessage(doc.conversationId, outgoing);
      res.status(201).json({ messageId: id });
    } catch (err) {
      next(err);
    }
  });

  /** Everything Aristoteles remembers, newest first.
   *
   * No screen renders this yet -- the approved UI has four tabs and this
   * cycle does not redesign it. It exists so the memory is inspectable from
   * outside the model: a memory I cannot read is one I cannot check, correct
   * or delete, and "the model says it remembers" is not a measurement.
   */
  router.get("/memories", async (_req, res, next) => {
    try {
      const docs = await couch.allDocs("memory:");
      res.json({
        memories: docs
          .map((d) => ({
            id: d._id,
            name: d.name,
            description: d.description ?? "",
            body: d.body ?? "",
            fromDiscussion: d.fromDiscussion ?? null,
            updatedAt: d.updatedAt ?? null,
          }))
          .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
