/** The Lyceum express app: the PWA shell's static files plus its read API. */
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Couch } from "./couch.js";
import { apiRouter } from "./api.js";

/** `dist/` sits beside `public/` in the image, so one `..` is right in both the
 *  compiled build and a `tsx src/` run from the repo root. */
const here = path.dirname(fileURLToPath(import.meta.url));
export const publicDir = path.join(here, "..", "public");

export function createApp(couch: Couch): Express {
  const app = express();

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/api", apiRouter(couch));

  app.use(express.static(publicDir, { extensions: ["html"] }));

  // A PWA is a single page: any non-API path the user lands on or reloads gets
  // the shell, which then routes. API 404s stay JSON 404s.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(502).json({ error: err.message });
  });

  return app;
}
