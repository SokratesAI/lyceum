/** Read side of the `lyceum` CouchDB database (build step 2's credentials).
 *
 * The app holds a database admin of `lyceum` and nothing else, injected by the
 * SealedSecret in `lyceum-config` as COUCHDB_URL / COUCHDB_USER /
 * COUCHDB_PASSWORD / COUCHDB_DB. Nothing here writes: the vault is the source
 * of truth and `tools.lyceum_import` in agora-persona-runner is the only writer.
 */

export type Doc = Record<string, any>;

export interface Couch {
  allDocs(prefix: string): Promise<Doc[]>;
  get(id: string): Promise<Doc | null>;
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
    const res = await fetch(url, { headers: { Authorization: auth() } });
    if (!res.ok) throw new Error(`CouchDB ${res.status} on ${prefix}`);
    const body = (await res.json()) as { rows: { doc: Doc }[] };
    return body.rows.map((r) => r.doc);
  },
  async get(id: string) {
    const res = await fetch(`${base()}/${encodeURIComponent(id)}`, {
      headers: { Authorization: auth() },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`CouchDB ${res.status} on ${id}`);
    return (await res.json()) as Doc;
  },
};
