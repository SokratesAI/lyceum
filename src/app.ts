/** The Lyceum express app: the PWA shell's static files plus its read API. */
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Couch } from "./couch.js";
import type { Agora } from "./agora.js";
import { NoToken } from "./agora.js";
import { apiRouter } from "./api.js";
import type { VaultStore } from "./vault.js";

/** `dist/` sits beside `public/` in the image, so one `..` is right in both the
 *  compiled build and a `tsx src/` run from the repo root. */
const here = path.dirname(fileURLToPath(import.meta.url));
export const publicDir = path.join(here, "..", "public");

/** A hash of every file under `public/`, so each deploy ships a service worker
 *  that differs by at least this stamp: the browser installs it, and its cache
 *  name changes with it (issue #267). */
export function buildStamp(dir: string = publicDir): string {
  const hash = createHash("sha256");
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else hash.update(path.relative(dir, p)).update(readFileSync(p));
    }
  };
  walk(dir);
  return hash.digest("hex").slice(0, 12);
}

export function createApp(couch: Couch, agora: Agora, vault?: VaultStore): Express {
  const app = express();

  app.use(express.json({ limit: "64kb" }));

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/api", apiRouter(couch, agora, vault));

  const sw = readFileSync(path.join(publicDir, "sw.js"), "utf8").replace("__BUILD__", buildStamp());
  app.get("/sw.js", (_req, res) => {
    res.set("Cache-Control", "no-cache").type("application/javascript").send(sw);
  });

  app.use(express.static(publicDir, { extensions: ["html"] }));

  // A PWA is a single page: any non-API path the user lands on or reloads gets
  // the shell, which then routes. API 404s stay JSON 404s.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  // A missing credential is 503, not 502: nothing upstream is broken and a
  // retry cannot help until the deployment carries the secret, so the status
  // has to tell those two apart for anyone reading the logs later.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err instanceof NoToken ? 503 : 502).json({ error: err.message });
  });

  return app;
}
