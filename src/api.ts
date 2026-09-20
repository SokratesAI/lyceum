/** The read-only API the PWA shell runs on -- build step 4.
 *
 * Three routes, one per screen the shell has: the course list, one course with
 * its chapters and sources, and one chapter's body. They return only what the
 * screen renders, so a course list does not ship six chapter bodies to a phone.
 */
import express, { type Router } from "express";
import type { Couch, Doc } from "./couch.js";

const byOrder = (a: Doc, b: Doc) => (a.order ?? 0) - (b.order ?? 0);

export function apiRouter(couch: Couch): Router {
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

  return router;
}
