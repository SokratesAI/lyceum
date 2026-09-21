/** The read-only API the PWA shell runs on -- build step 4.
 *
 * Three routes, one per screen the shell has: the course list, one course with
 * its chapters and sources, and one chapter's body. They return only what the
 * screen renders, so a course list does not ship six chapter bodies to a phone.
 */
import { appendNote, httpVault, type VaultStore } from "./vault.js";
import express, { type Router } from "express";
import type { Couch, Doc } from "./couch.js";
import { OWNER, personaId, type Agora } from "./agora.js";
import { briefing, contextBlock, parseMemories, parseRecalls, stripMarkers, upsert } from "./memory.js";
import { anchorClaim, paragraphsOf } from "./claims.js";
import { BinaryFile, listProjects, projectPage, readVaultFile, STAGES, type StageDiscussion } from "./workshop.js";

const byOrder = (a: Doc, b: Doc) => (a.order ?? 0) - (b.order ?? 0);

/**
 * The demo's basis paragraph under a course's hero: one sentence on what the
 * course was built from. The demo's own first line reads "Built by a Nova
 * cycle from 20 researched source files. The wiki pages are the chapters; the
 * raw/ files are the sources behind them." Every fact in it is read off the
 * course document the importer wrote, so no model writes this sentence and a
 * re-import that changes the counts changes it too.
 */
export function basisOf(course: Doc, sourceCount: number, chapterCount: number): string {
  const files = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const root = course.vaultRoot ?? "";
  if (course.generatedBy) {
    const by = course.generatedBy === "llm_wiki" ? "a Nova cycle" : course.generatedBy;
    const on = course.generated ? ` on ${String(course.generated).slice(0, 10)}` : "";
    return `Built by ${by}${on} from ${files(sourceCount, "researched source file")} in ${root}raw/. The wiki pages are the chapters; the raw/ files are the sources behind them.`;
  }
  return `Hand-written in ${root}, not generated: ${files(chapterCount, "chapter")} and ${files(sourceCount, "source file")}, read as they are.`;
}

/** A discussion's own id. Random rather than derived from the title: two
 *  threads about the same thing are two threads, and a title can be edited. */
const discussionId = () => `discussion:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** A practice session is a handful of cards, not a queue to clear -- the spec
 *  has no due dates and nothing is owed, so the session ends because it is
 *  over and not because he finished a backlog. */
const SESSION_CARDS = 12;
const MAX_SESSION_CARDS = 50;
const MAX_ANSWERS = 100;

/** `missed` is the only result that changes what he sees next; `skipped` and
 *  `seen` (a written answer, which nothing here grades) are recorded so the
 *  card moves out of the never-seen tier. */
const RESULTS = ["correct", "missed", "skipped", "seen"];

/** The grader stores `true`/`false` as a lower-case string. */
const tfLabel = (answer: unknown) => (String(answer).toLowerCase() === "true" ? "True" : "False");

const MAX_TEXT = 8000;

/** The approved demo's "Where it goes" chips, in its order. */
export const NOTE_DESTS = [
  "work/platform/projects/platform atlas/notes.md",
  "projects/sokrates/projects/nova/notes.md",
  "learn.md",
  "notes.md",
];
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

export function apiRouter(couch: Couch, agora: Agora, vault: VaultStore = httpVault): Router {
  const router = express.Router();

  router.get("/courses", async (_req, res, next) => {
    try {
      const docs = await couch.allDocs("course:");
      // One id-only read for every card in the database, rather than one read
      // per course: the number is only used to decide whether a course can be
      // practised at all, and a card body has no business on this screen.
      const cardIds = await couch.ids("card:");
      res.json({
        courses: docs.map((d) => ({
          slug: d.slug,
          title: d.title,
          chapterCount: (d.chapterIds ?? []).length,
          sourceCount: (d.sourceIds ?? []).length,
          cardCount: cardIds.filter((id) => id.startsWith(`card:${d.slug}:`)).length,
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
      // The demo's "Evidence behind this course" bar: how many claims sit at
      // each GRADE level. A grade outside the four the bar draws is counted
      // under its own name rather than folded into one of them.
      const grades: Record<string, number> = {};
      for (const c of await couch.allDocs(`claim:${req.params.slug}:`)) {
        grades[c.grade] = (grades[c.grade] ?? 0) + 1;
      }
      res.json({
        course: {
          slug: course.slug,
          title: course.title,
          spine: course.spine,
          basis: basisOf(course, sources.length, chapters.length),
        },
        grades,
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

  /** One chapter, with its claim atoms anchored to the paragraphs they came
   * from -- build step 7, the app's half.
   *
   * The marks are the credibility system made visible: a settled finding and an
   * untested assertion read identically as prose, and the whole point of
   * extracting claim atoms is that the reader can tell them apart while
   * reading. `paragraph` says where each mark goes; see `claims.ts` for why it
   * is a paragraph index rather than a character offset, and why an ambiguous
   * anchor deliberately returns null instead of guessing.
   *
   * A `contradicted` or `unverified` claim gets a mark like any other. That is
   * the opposite of the rule in `tools.lyceum_cards`, which refuses to build a
   * card from one, and the two are consistent: practising an assertion the
   * source contradicts teaches it, whereas *marking* it is the only way the
   * reader ever finds out.
   */
  router.get("/chapters/:id", async (req, res, next) => {
    try {
      const doc = await couch.get(req.params.id);
      if (!doc || doc.type !== "chapter") {
        return res.status(404).json({ error: "no such chapter" });
      }
      const paragraphs = paragraphsOf(doc.body ?? "");
      const claims = (await couch.allDocs(`claim:${doc._id.slice("chapter:".length)}:`))
        .sort(byOrder)
        .map((claim) => ({
          id: claim._id,
          text: claim.text,
          grade: claim.grade,
          status: claim.status,
          quote: claim.quote ?? null,
          sourceIds: claim.sourceIds ?? [],
          checkedAgainst: claim.checkedAgainst ?? null,
          paragraph: anchorClaim(paragraphs, claim),
        }));
      // Just the sources these claims cite, titled. The trace names the source
      // it was checked against, and an id is not a name.
      const cited = new Set(claims.flatMap((c) => c.sourceIds as string[]));
      const sources = Object.fromEntries(
        (await couch.allDocs(`source:${doc.courseId.slice("course:".length)}:`))
          .filter((s) => cited.has(s._id))
          .map((s) => [s._id, { id: s._id, title: s.title, url: s.url ?? null }]),
      );
      res.json({
        chapter: {
          id: doc._id,
          title: doc.title,
          body: doc.body,
          courseId: doc.courseId,
          sourceIds: doc.sourceIds ?? [],
        },
        claims,
        sources,
      });
    } catch (err) {
      next(err);
    }
  });


  /** A practice session's cards -- build step 8, the app's half.
   *
   * `tools.lyceum_cards` in agora-persona-runner writes the cards; this route
   * decides which ones he sees now and in what order. The spec's constraint is
   * the ordering one: **no due dates, ever** (product principle 1), so nothing
   * here is ever "owed" or "late" -- a card is only ever earlier or later in
   * the next session he chooses to start.
   *
   * Order: never-seen first, then the ones he missed last time, then by how
   * long ago he saw them. That is a retrievability proxy and deliberately not
   * FSRS -- FSRS needs an interval history this database does not have yet,
   * and a half-implemented scheduler that invents intervals would order worse
   * than this while looking principled.
   *
   * A card's `grade` is copied through untouched, because the whole point of
   * step 7 is that a settled finding and an untested assertion are not the
   * same card, and the screen has to be able to show which is which.
   */
  router.get("/courses/:slug/practice", async (req, res, next) => {
    try {
      const course = await couch.get(`course:${req.params.slug}`);
      if (!course) return res.status(404).json({ error: "no such course" });

      const asked = Number(req.query.limit ?? SESSION_CARDS);
      const limit = Number.isFinite(asked)
        ? Math.min(Math.max(Math.trunc(asked), 1), MAX_SESSION_CARDS)
        : SESSION_CARDS;

      const cards = await couch.allDocs(`card:${req.params.slug}:`);
      const states = await couch.allDocs(`cardstate:${req.params.slug}:`);
      const sources = await couch.allDocs(`source:${req.params.slug}:`);
      const titleOf = new Map(sources.map((s) => [s._id, s.title as string]));
      const stateOf = new Map(states.map((s) => [s.cardId as string, s]));

      const rank = (c: Doc) => {
        const st = stateOf.get(c._id);
        if (!st) return { tier: 0, at: "" };
        return { tier: st.lastResult === "missed" ? 1 : 2, at: st.lastSeen ?? "" };
      };
      const ordered = [...cards].sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra.tier !== rb.tier) return ra.tier - rb.tier;
        if (ra.at !== rb.at) return ra.at < rb.at ? -1 : 1;
        return a._id < b._id ? -1 : 1;
      });

      res.json({
        course: { slug: course.slug, title: course.title },
        total: cards.length,
        cards: ordered.slice(0, limit).map((c) => ({
          id: c._id,
          cardType: c.cardType,
          prompt: c.prompt,
          // True/false is stored with no options because its two options are
          // implied; the screen needs real buttons, so they are made here and
          // not in the front end, where a second copy of this rule would rot.
          options: c.cardType === "true_false" ? ["True", "False"] : (c.options ?? []),
          answer: c.cardType === "true_false" ? tfLabel(c.answer) : c.answer,
          why: c.why ?? "",
          grade: c.grade,
          claimStatus: c.claimStatus,
          chapterId: c.chapterId,
          sources: (c.sourceIds ?? [])
            .map((id: string) => titleOf.get(id) ?? id)
            .filter(Boolean),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  /** What happened in a session, so the next one can order itself.
   *
   * One document per card rather than one per session: the ordering above only
   * ever asks "how did this card go last time", and a growing list of session
   * documents would make that a scan. Counts are kept because they cost one
   * field each and a card he has missed three times is worth knowing about
   * later; nothing reads them yet, and nothing schedules anything.
   */
  router.post("/practice/answers", async (req, res, next) => {
    try {
      const answers = Array.isArray(req.body?.answers) ? req.body.answers : null;
      if (!answers) return res.status(400).json({ error: "answers must be an array" });
      if (answers.length > MAX_ANSWERS) {
        return res.status(400).json({ error: `at most ${MAX_ANSWERS} answers` });
      }
      const now = new Date().toISOString();
      let stored = 0;
      for (const a of answers) {
        const cardId = typeof a?.cardId === "string" ? a.cardId : "";
        const result = RESULTS.includes(a?.result) ? a.result : null;
        if (!cardId.startsWith("card:") || !result) {
          return res.status(400).json({ error: "each answer needs a card id and a result" });
        }
        const card = await couch.get(cardId);
        if (!card || card.type !== "card") {
          return res.status(404).json({ error: `no such card: ${cardId}` });
        }
        const id = `cardstate:${cardId.slice("card:".length)}`;
        const prev = await couch.get(id);
        await couch.put({
          ...(prev ?? {}),
          _id: id,
          type: "cardState",
          cardId,
          courseId: card.courseId,
          seen: (prev?.seen ?? 0) + 1,
          missed: (prev?.missed ?? 0) + (result === "missed" ? 1 : 0),
          lastResult: result,
          lastSeen: now,
        });
        stored += 1;
      }
      res.json({ stored });
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
  /** What a discussion was opened from: a claim he tapped "ask about" on, or
   * the chapter or course the Discuss button sat over. It is the demo's
   * ClaimTalk and GeneralTalk -- the thread opens already knowing what it is
   * about, so his first message can be "why?" rather than a paste. `null` for
   * an ordinary thread; `undefined` for a body this refuses. */
  const GRADES = ["high", "moderate", "low", "ungrounded"];
  function aboutOf(raw: any): { kind: string; text: string; grade?: string; where?: string } | null | undefined {
    if (raw == null) return null;
    if (typeof raw !== "object") return undefined;
    const kind = raw.kind === "claim" || raw.kind === "chapter" ? raw.kind : null;
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!kind || !text || text.length > MAX_TEXT) return undefined;
    const out: { kind: string; text: string; grade?: string; where?: string } = { kind, text };
    if (typeof raw.grade === "string" && GRADES.includes(raw.grade)) out.grade = raw.grade;
    if (typeof raw.where === "string" && raw.where.trim()) out.where = raw.where.trim().slice(0, 200);
    return out;
  }
  const aboutLine = (a: { kind: string; text: string; grade?: string; where?: string }) =>
    a.kind === "claim"
      ? `He opened this discussion from one claim${a.where ? ` in "${a.where}"` : ""}` +
        `${a.grade ? `, graded ${a.grade}` : ""}. The claim: "${a.text}"`
      : `He opened this discussion from "${a.text}"${a.where ? `, in the course "${a.where}"` : ""}.`;

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
            about: d.about ?? null,
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
    const about = aboutOf(req.body?.about);
    if (about === undefined) return res.status(400).json({ error: "that is not something a discussion can be about" });
    // A workshop discussion belongs to one project at one DSRM stage, and the
    // bench lists it there. Checked before Agora is asked for anything, so a
    // refused body leaves no conversation behind.
    const ws = req.body?.workshop;
    let workshop: { project: string; stage: string } | null = null;
    if (ws != null) {
      const project = typeof ws?.project === "string" ? ws.project : "";
      const stage = typeof ws?.stage === "string" ? ws.stage : "";
      if (!(STAGES as readonly string[]).includes(stage)) return res.status(400).json({ error: "that is not a DSRM stage" });
      if (!project || !(await couch.get(`project:${project}`))) return res.status(404).json({ error: "no such project" });
      workshop = { project, stage };
    }
    try {
      const conversationId = await agora.createConversation(`Lyceum — ${title}`);
      const doc = await couch.put({
        _id: discussionId(),
        type: "discussion",
        title,
        scope: workshop ? "workshop" : "global",
        ...(workshop ?? {}),
        conversationId,
        personaId: personaId(),
        createdAt: new Date().toISOString(),
        ...(about ? { about } : {}),
      });
      res.status(201).json({ discussion: { id: doc._id, title, conversationId, about, ...(workshop ?? {}) } });
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
        discussion: { id: doc._id, title: doc.title, about: doc.about ?? null },
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
        const brief = briefing(await couch.allDocs("memory:"));
        outgoing = `${contextBlock(doc.about ? `${brief}\n\n${aboutLine(doc.about)}` : brief)}\n\n${text}`;
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

  /** A note, written down now and shaped later -- the demo's Note sheet.
   *
   * It is appended to one of the vault files the demo's "Where it goes" chips
   * name, as a markdown bullet, so it is in his vault and not in this app. Only
   * those files: the path comes from the phone and is checked against the list.
   */
  router.post("/notes", async (req, res, next) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "a note needs some text" });
    if (text.length > MAX_TEXT) return res.status(400).json({ error: "that note is too long" });
    const dest = req.body?.dest;
    if (typeof dest !== "string" || !NOTE_DESTS.includes(dest)) {
      return res.status(400).json({ error: "dest must be one of the note files" });
    }
    try {
      const { created } = await appendNote(vault, dest, text);
      res.status(201).json({ note: { dest, created } });
    } catch (err) {
      next(err);
    }
  });

  /* The workshop (build step 10). A project lists its own files, and a file is
   * read only if the project lists it -- this is not a way to read the vault. */
  router.get("/workshop", async (_req, res, next) => {
    try {
      res.json({ projects: await listProjects(couch) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/workshop/:slug", async (req, res, next) => {
    try {
      const p = await couch.get(`project:${req.params.slug}`);
      if (!p) return res.status(404).json({ error: "no such project" });
      const mine = (await couch.allDocs("discussion:")).filter((d) => d.project === p.slug);
      // The count is what he would see on opening it, so it drops what
      // stripMarkers blanks. One unreadable transcript costs its own count,
      // not the page.
      const discussions: StageDiscussion[] = await Promise.all(
        mine.map(async (d) => {
          let messages: number | null = null;
          try {
            messages = (await agora.messages(d.conversationId, THREAD_LIMIT)).filter((m) => stripMarkers(m.text)).length;
          } catch {}
          return { id: d._id, title: d.title, stage: d.stage, createdAt: d.createdAt ?? null, messages };
        }),
      );
      res.json({ project: projectPage(p, discussions) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/workshop/:slug/file", async (req, res, next) => {
    try {
      const p = await couch.get(`project:${req.params.slug}`);
      if (!p) return res.status(404).json({ error: "no such project" });
      const rel = String(req.query.path ?? "");
      if (!Object.prototype.hasOwnProperty.call(p.files ?? {}, rel)) {
        return res.status(404).json({ error: "not a file of this project" });
      }
      const path = `${p.root}/${rel}`;
      const text = await readVaultFile(vault, path);
      if (text === null) return res.status(404).json({ error: "the file is gone from the vault" });
      res.json({ file: { path, text } });
    } catch (err) {
      if (err instanceof BinaryFile) return res.status(415).json({ error: "not a text file" });
      next(err);
    }
  });

  return router;
}
