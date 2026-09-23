/** The `lyceum` CouchDB database (build step 2's credentials).
 *
 * The app holds a database admin of `lyceum`, injected by the
 * SealedSecret in `lyceum-config` as COUCHDB_URL / COUCHDB_USER /
 * COUCHDB_PASSWORD / COUCHDB_DB. The same user is a member of `obsidian` and
 * `nova`, for the Note sheet's appends only (src/vault.ts).
 *
 * **Course content is read-only here and stays that way**: the vault is the
 * source of truth for chapters and sources, and `tools.lyceum_import` in
 * agora-persona-runner is their only writer. `put` exists for the app's own
 * state -- a discussion row is born in the app and has no vault original, so
 * there is nothing for a cycle to overwrite (the spec's "CouchDB for derived
 * state only"). Nothing calls it with a `course:`/`chapter:`/`source:` id.
 */

import { DB_TIMEOUT_MS, deadline } from "./http.js";

export type Doc = Record<string, any>;

export interface Couch {
  allDocs(prefix: string): Promise<Doc[]>;
  /** Just the ids under a prefix. The course list needs to know how many cards
   *  each course has, and `allDocs` would ship every card body to answer it. */
  ids(prefix: string): Promise<string[]>;
  get(id: string): Promise<Doc | null>;
  put(doc: Doc): Promise<Doc>;
}

function auth(): string {
  const user = process.env.COUCHDB_USER ?? "";
  const pass = process.env.COUCHDB_PASSWORD ?? "";
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

function base(): string {
  const url = (process.env.COUCHDB_URL ?? "").replace(/\/+$/, "");
  const db = process.env.COUCHDB_DB ?? "lyceum";
  return `${url}/${db}`;
}

/** `￰` is the conventional CouchDB end-key: it sorts after every printable
 *  character, so `course:` .. `course:￰` is exactly the `course:` prefix. */
export const httpCouch: Couch = {
  async allDocs(prefix: string) {
    const url =
      `${base()}/_all_docs?include_docs=true` +
      `&startkey=${encodeURIComponent(JSON.stringify(prefix))}` +
      `&endkey=${encodeURIComponent(JSON.stringify(prefix + "￰"))}`;
    const res = await fetch(url, deadline(DB_TIMEOUT_MS, { headers: { Authorization: auth() } }));
    if (!res.ok) throw new Error(`CouchDB ${res.status} on ${prefix}`);
    const body = (await res.json()) as { rows: { doc: Doc }[] };
    return body.rows.map((r) => r.doc);
  },
  async ids(prefix: string) {
    const url =
      `${base()}/_all_docs` +
      `?startkey=${encodeURIComponent(JSON.stringify(prefix))}` +
      `&endkey=${encodeURIComponent(JSON.stringify(prefix + "￰"))}`;
    const res = await fetch(url, deadline(DB_TIMEOUT_MS, { headers: { Authorization: auth() } }));
    if (!res.ok) throw new Error(`CouchDB ${res.status} on ${prefix}`);
    const body = (await res.json()) as { rows: { id: string }[] };
    return body.rows.map((r) => r.id);
  },
  async put(doc: Doc) {
    const res = await fetch(`${base()}/${encodeURIComponent(doc._id)}`, deadline(DB_TIMEOUT_MS, {
      method: "PUT",
      headers: { Authorization: auth(), "content-type": "application/json" },
      body: JSON.stringify(doc),
    }));
    if (!res.ok) throw new Error(`CouchDB ${res.status} writing ${doc._id}`);
    const body = (await res.json()) as { rev: string };
    return { ...doc, _rev: body.rev };
  },
  async get(id: string) {
    const res = await fetch(`${base()}/${encodeURIComponent(id)}`, deadline(DB_TIMEOUT_MS, {
      headers: { Authorization: auth() },
    }));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`CouchDB ${res.status} on ${id}`);
    return (await res.json()) as Doc;
  },
};
