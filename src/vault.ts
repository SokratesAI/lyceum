/** Appending a note to a markdown file in the owner's vault.
 *
 * The vault is Obsidian LiveSync's CouchDB format: a file is a document whose
 * `_id` is its path and whose `children` list the ids of `leaf` chunks, and the
 * file's text is those chunks concatenated in order. So an append never has to
 * touch his existing text: it writes one new chunk holding only the note and
 * adds its id to the end of `children`. Every chunk he already has stays
 * byte-for-byte the one Obsidian wrote. A chunk id is a hash of its content,
 * the same `h:<16 hex>` shape agora-persona-runner's vault_tool falls back to.
 *
 * Two databases: files under Nova's folders live in `nova`, everything else in
 * `obsidian` -- the rule vault_tool's `db_for` holds, copied here on purpose.
 */
import { createHash } from "node:crypto";

export interface VaultStore {
  get(db: string, id: string): Promise<Record<string, any> | null>;
  put(db: string, doc: Record<string, any>): Promise<void>;
}

const NOVA_DB_FOLDERS = ["projects/sokrates/projects/agora/nova/", "projects/sokrates/projects/nova/"];
const NOVA_DB_FILES = ["projects/sokrates/projects/agora/journal-digest.md"];

export function dbFor(path: string): string {
  const p = path.toLowerCase();
  return NOVA_DB_FOLDERS.some((f) => p.startsWith(f)) || NOVA_DB_FILES.includes(p) ? "nova" : "obsidian";
}

export function chunkId(text: string): string {
  return "h:" + createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/** The note as a markdown bullet; later lines are indented under it. */
export function asBullet(text: string): string {
  const [first, ...rest] = text.trim().split(/\r?\n/);
  return ["- " + first, ...rest.map((l) => (l ? "  " + l : ""))].join("\n") + "\n";
}

/** Append `text` to the file at `path`, creating the file if it is missing. */
export async function appendNote(store: VaultStore, path: string, text: string, now = Date.now()): Promise<{ created: boolean }> {
  const db = dbFor(path);
  const doc = await store.get(db, path);
  const live = doc && !doc._deleted && !doc.deleted ? doc : null;
  let children: string[] = live ? [...(live.children ?? [])] : [];
  let size = live ? Number(live.size ?? 0) : 0;

  if (live && children.length === 0 && live.data) {
    // An inline-data document: move its text into a chunk first, unchanged.
    const id = chunkId(live.data);
    await putChunk(store, db, id, live.data);
    children = [id];
  }
  let endsWithNewline = true;
  if (children.length) {
    const last = await store.get(db, children[children.length - 1]);
    if (!last) throw new Error(`vault file ${path} points at a missing chunk; not appending to it`);
    endsWithNewline = String(last.data ?? "").endsWith("\n") || String(last.data ?? "") === "";
  }
  const add = (endsWithNewline ? "" : "\n") + asBullet(text);
  const id = chunkId(add);
  await putChunk(store, db, id, add);
  size += Buffer.byteLength(add, "utf8");

  const next: Record<string, any> = {
    _id: path, path, data: "", children: [...children, id], size,
    ctime: live?.ctime ?? now, mtime: now, type: "plain", eden: {},
  };
  if (doc?._rev) next._rev = doc._rev;
  await store.put(db, next);
  return { created: !live };
}

/** Write a new file at `path` holding `text`, as one chunk. Never overwrites:
 *  a live file already at that path is refused, so a save cannot replace text
 *  he wrote. A tombstoned document at the path is replaced in place.
 *
 *  LiveSync keys a file by its path lowercased and keeps the real casing only
 *  in `path` (measured: 910 documents under work/, no id with a capital, 393
 *  paths with one), so the id is lowercased and `path` is written as given. */
export async function createFile(store: VaultStore, path: string, text: string, now = Date.now()): Promise<void> {
  const db = dbFor(path);
  const key = path.toLowerCase();
  const doc = await store.get(db, key);
  if (doc && !doc._deleted && !doc.deleted) throw new FileExists(path);
  const id = chunkId(text);
  await putChunk(store, db, id, text);
  const next: Record<string, any> = {
    _id: key, path, data: "", children: [id], size: Buffer.byteLength(text, "utf8"),
    ctime: now, mtime: now, type: "plain", eden: {},
  };
  if (doc?._rev) next._rev = doc._rev;
  await store.put(db, next);
}

export class FileExists extends Error {}

async function putChunk(store: VaultStore, db: string, id: string, data: string) {
  // Content-addressed: if it exists, it already holds exactly this text.
  if (await store.get(db, id)) return;
  await store.put(db, { _id: id, data, type: "leaf", children: [] });
}

function auth(): string {
  const user = process.env.VAULT_COUCHDB_USER ?? process.env.COUCHDB_USER ?? "";
  const pass = process.env.VAULT_COUCHDB_PASSWORD ?? process.env.COUCHDB_PASSWORD ?? "";
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export const httpVault: VaultStore = {
  async get(db, id) {
    const url = (process.env.COUCHDB_URL ?? "").replace(/\/+$/, "");
    const res = await fetch(`${url}/${db}/${encodeURIComponent(id)}`, { headers: { Authorization: auth() } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`vault ${res.status} reading ${id}`);
    return (await res.json()) as Record<string, any>;
  },
  async put(db, doc) {
    const url = (process.env.COUCHDB_URL ?? "").replace(/\/+$/, "");
    const res = await fetch(`${url}/${db}/${encodeURIComponent(doc._id)}`, {
      method: "PUT",
      headers: { Authorization: auth(), "content-type": "application/json" },
      body: JSON.stringify(doc),
    });
    if (res.status === 409 && String(doc._id).startsWith("h:")) return;
    if (!res.ok) throw new Error(`vault ${res.status} writing ${doc._id}`);
  },
};
