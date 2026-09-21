/** The workshop's read side: DSRM projects, their files by stage, and a file's text.
 *
 * A project is one `project:<slug>` document in the lyceum database. Its files
 * are not copied into it: `files` maps a vault path to the DSRM stage the file
 * belongs to, and the text is read out of the vault when a file is opened, so
 * the vault stays the one copy. Only a path the project lists can be read
 * through this module -- it is not a general vault reader.
 */
import type { Couch, Doc } from "./couch.js";
import { dbFor, type VaultStore } from "./vault.js";

/** Design Science Research (Peffers et al., 2007), the demo's `DSRM` keys. */
export const STAGES = ["problem", "objectives", "design", "demo", "evaluation", "communication"] as const;

export const nameOf = (path: string) => {
  const n = path.split("/").pop() ?? path;
  return n.endsWith(".md") ? n.slice(0, -3) : n;
};

export const extOf = (path: string) => {
  const n = path.split("/").pop() ?? path;
  const i = n.lastIndexOf(".");
  return i < 0 ? "" : n.slice(i + 1).toLowerCase();
};

export function projectCard(p: Doc) {
  return {
    slug: p.slug,
    title: p.title,
    stage: p.stage,
    line: p.line ?? "",
    fileCount: Object.keys(p.files ?? {}).length,
  };
}

/** A discussion as the bench lists it: the demo's "n messages · 2 Jun" row.
 *  `messages` is null when Agora could not be read for the count. */
export type StageDiscussion = { id: string; title: string; stage: string; createdAt: string | null; messages: number | null };

/** The project page: every stage, with the files placed in it, in the order the
 *  record lists them, and the discussions opened at that stage, newest first. */
export function projectPage(p: Doc, discussions: StageDiscussion[] = []) {
  const files = Object.entries<string>(p.files ?? {});
  const newest = [...discussions].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return {
    ...projectCard(p),
    root: p.root,
    stages: STAGES.map((stage) => ({
      stage,
      discussions: newest.filter((d) => d.stage === stage).map(({ stage: _s, ...d }) => d),
      files: files
        .filter(([, s]) => s === stage)
        .map(([rel]) => ({ path: rel, name: nameOf(rel), ext: extOf(rel) })),
    })),
  };
}

/** Extensions that are text once decoded; anything else LiveSync stores is bytes. */
const TEXT_EXTS = new Set(["md", "txt", "jsx", "js", "ts", "tsx", "json", "csv", "yaml", "yml", "html", "css"]);

export class BinaryFile extends Error {}

/** A vault file's text: inline `data`, or its `children` chunks concatenated in order.
 *  LiveSync stores a non-markdown file (`type: "newnote"`) as base64, so that is
 *  decoded; a file whose extension is not text throws BinaryFile rather than
 *  handing back bytes as a string. */
export async function readVaultFile(store: VaultStore, path: string): Promise<string | null> {
  const db = dbFor(path);
  // LiveSync ids are the path lowercased; a saved file's name keeps its capitals.
  const doc = await store.get(db, path.toLowerCase());
  if (!doc || doc._deleted || doc.deleted) return null;
  const children: string[] = doc.children ?? [];
  const binary = doc.type === "newnote";
  if (binary && !TEXT_EXTS.has(extOf(path))) throw new BinaryFile(path);
  const decode = (t: string) => (binary ? Buffer.from(t, "base64").toString("utf8") : t);
  if (!children.length) return decode(String(doc.data ?? ""));
  const parts: string[] = [];
  for (const id of children) {
    const chunk = await store.get(db, id);
    if (!chunk) throw new Error(`vault file ${path} points at a missing chunk`);
    parts.push(String(chunk.data ?? ""));
  }
  return decode(parts.join(""));
}

export async function listProjects(couch: Couch) {
  return (await couch.allDocs("project:")).map(projectCard);
}
