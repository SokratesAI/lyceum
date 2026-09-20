/** Aristoteles's cross-chat memory -- the second half of build step 5.
 *
 * The spec's instruction is to copy Nova's shape: "small per-topic memory
 * files plus one lightweight index loaded per chat, never full transcript
 * replay." Nova's own memory is exactly that -- one fact per file with a
 * `name` and a one-line `description`, and a `MEMORY.md` index of those two
 * fields loaded into every session, with a body read only when the index line
 * looks relevant. The reason is cost: a transcript replay grows without bound
 * and is mostly noise, while an index line is ~15 tokens and is the part that
 * tells you whether to go and look.
 *
 * Aristoteles is an Agora persona, so he has no tool call and no filesystem.
 * The whole mechanism therefore runs over the one channel he does have -- the
 * messages in his own thread -- and it is two markers:
 *
 *   `<memory name="..." description="...">body</memory>` in a reply writes a
 *   memory. Upserted by slug, so saying the same thing twice updates one
 *   document rather than growing a pile.
 *
 *   `<recall name="..."/>` in a reply asks for one back. The app answers by
 *   posting that memory's body into the thread, which is what "read the body
 *   on demand" has to look like when the reader cannot open a file.
 *
 * Both markers are stripped out of what the page renders. They are addressed
 * to the app, not to the person reading, and a bubble containing one would be
 * a leaked implementation detail.
 */
import type { Couch, Doc } from "./couch.js";

export interface MemoryFile {
  name: string;
  description: string;
  body: string;
}

export const memoryId = (name: string) => `memory:${slug(name)}`;

/** Deliberately lossy and deliberately stable: "Goal setting" and
 *  "goal-setting" are the same memory, because Aristoteles writes the name in
 *  prose and will not spell it identically twice. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const MEMORY_RE =
  /<memory\s+name="([^"]{1,120})"\s+description="([^"]{0,300})"\s*>([\s\S]*?)<\/memory>/gi;
const RECALL_RE = /<recall\s+name="([^"]{1,120})"\s*\/?>/gi;

/** Every memory written in one message. Pure, and exported so a test can run
 *  it -- the parse is the part with a fact in it, and a parser living inside
 *  the route is a parser nothing can check. */
export function parseMemories(text: string): MemoryFile[] {
  const out: MemoryFile[] = [];
  for (const m of String(text ?? "").matchAll(MEMORY_RE)) {
    const name = m[1].trim();
    const body = m[3].trim();
    if (!name || !body) continue;
    out.push({ name, description: m[2].trim(), body });
  }
  return out;
}

/** Every memory asked for in one message, by slug, in order and deduplicated. */
export function parseRecalls(text: string): string[] {
  const seen = new Set<string>();
  for (const m of String(text ?? "").matchAll(RECALL_RE)) {
    const s = slug(m[1]);
    if (s) seen.add(s);
  }
  return [...seen];
}

const CONTEXT_RE = /<context>[\s\S]*?<\/context>/gi;

/** Wrap text the app is saying to Aristoteles rather than to Edvard.
 *
 * **It is posted as Edvard, and that is a measurement rather than a choice.**
 * I first built this as its own sender ("Lyceum") and checked it against the
 * live system before merging: Agora records the message and attributes it
 * correctly, and the persona never sees it. Asked to quote the first message
 * in a thread whose first message was a briefing from "Lyceum", Aristoteles
 * answered "NOTHING BEFORE." (conversation
 * da3dc350-9398-416b-b259-1c46ed03085b, 2026-09-20 22:42 Oslo). Only the
 * owner's turns reach the model. So app-to-model text has to ride inside an
 * owner message, and the marker is what keeps it off Edvard's screen.
 */
export const contextBlock = (text: string) => `<context>\n${text}\n</context>`;

/** What the page shows: the reply with every marker taken out. */
export function stripMarkers(text: string): string {
  return String(text ?? "")
    .replace(MEMORY_RE, "")
    .replace(RECALL_RE, "")
    .replace(CONTEXT_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The index loaded into a new thread -- names and descriptions only.
 *
 * No body and no cap. The body is the expensive half and `<recall>` fetches
 * it; the index is two short fields per memory, which is the same trade Nova's
 * own `MEMORY.md` makes. A cap here would be a number I have not measured.
 */
export function briefing(memories: Doc[]): string {
  const lines = memories
    .filter((d) => d?.name)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map((d) => `- ${d.name} — ${d.description ?? ""}`.trimEnd());

  const how = [
    "This block is from the Lyceum app, not from Edvard. He cannot see it and will not answer questions about it.",
    "",
    'To remember something across threads, put `<memory name="short name" description="one line">the fact</memory>` in your reply. Writing the same name again replaces it, so correct a memory rather than adding a second one.',
    'To read one of the memories below, put `<recall name="its name"/>` in your reply and the app posts the body back into this thread.',
    "Both markers are stripped before Edvard sees your message, so he never reads the machinery.",
  ];

  const index = lines.length
    ? ["", "What you already remember:", ...lines]
    : ["", "You remember nothing yet; this is the first thread."];

  return [...how, ...index].join("\n");
}

/** Write one memory, carrying `_rev` so the second write of a name is an
 *  update rather than a CouchDB 409. */
export async function upsert(
  couch: Couch,
  file: MemoryFile,
  fromDiscussion: string,
): Promise<Doc> {
  const _id = memoryId(file.name);
  const existing = await couch.get(_id);
  return couch.put({
    ...(existing ?? {}),
    _id,
    type: "memory",
    name: file.name,
    description: file.description,
    body: file.body,
    fromDiscussion,
    updatedAt: new Date().toISOString(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  });
}
