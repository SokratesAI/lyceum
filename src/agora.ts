/** Aristoteles's side of the wire -- build step 5.
 *
 * Lyceum runs no model of its own. Aristoteles is an Agora persona
 * (`ARISTOTELES_PERSONA_ID`), and a discussion in this app is an Agora
 * conversation with one row in the `lyceum` database pointing at it. Agora
 * owns the transcript; this database owns what the transcript is *about* --
 * the topic now, and the workshop project and DSRM stage when step 10 lands.
 * Keeping one copy of the messages is deliberate: a second copy here would
 * diverge from the one the model actually reads.
 *
 * Two apps, and they are not interchangeable (ADR 0007). Writes go to the
 * agent-facing app on `AGORA_INTERNAL_URL` and carry `x-agora-token`; reads
 * go to the public app on `AGORA_URL` and carry nothing. A write sent to the
 * public app is a 404, and a write sent without the token is a 401 that reads
 * like Agora rejected the message when in fact it carried no credential.
 */

import { AGORA_TIMEOUT_MS, deadline } from "./http.js";

export interface Message {
  sender: string;
  text: string;
  ts: string | null;
  /** Lyceum's own input to the model (agora#102): a memory, a briefing. */
  context?: boolean;
}

export interface Agora {
  createConversation(name: string): Promise<string>;
  postMessage(conversationId: string, text: string): Promise<string>;
  /** Text for Aristoteles that is not from Edvard. Agora stores it under
   *  Lyceum's own sender with `context: true`; the runner reads it as input
   *  and starts a turn on it, so it never has to ride inside his message. */
  postContext(conversationId: string, text: string): Promise<string>;
  messages(conversationId: string, limit: number): Promise<Message[]>;
}

/** Thrown when this pod holds no `AGORA_TOKEN`.
 *
 * It is its own type so the route can answer 503 rather than 502: nothing is
 * broken upstream and a retry will not help until the deployment carries the
 * secret. `lyceum-config` references `agora-agent-token` with `optional: true`
 * exactly as `nova-site` does, so a pod that came up before the secret existed
 * runs fine with the chat routes refusing and every other route working.
 */
/** The rows a page should render, out of the rows Agora returns.
 *
 * A pure function on purpose: the filter is the part with a fact in it, and a
 * test that stubs the `Agora` interface never runs the transport, so a filter
 * living only inside `httpAgora` is a filter nothing can check. This is
 * exported and tested against rows copied off the live wire.
 *
 * A narration row carries an `activity` **object**; it is not a row with
 * `type: "activity"`, which is what I assumed before reading one. Agora emits
 * them while the model works -- the one this was measured against was
 * `{capability: "assistant_text", retracted: true}` with the text
 * `"assistant_text: "`, which renders as a bubble saying exactly that. The
 * finished reply arrives as its own row 25ms later, so dropping every row
 * carrying the field loses nothing.
 */
export function visibleMessages(rows: any[]): Message[] {
  return (rows ?? [])
    .filter((m) => !m?.activity && typeof m?.text === "string" && m.text.trim())
    .map((m) => ({
      sender: String(m.sender ?? ""),
      text: String(m.text),
      ts: m.ts ?? m.createdAt ?? null,
      ...(m.context === true ? { context: true } : {}),
    }));
}

export class NoToken extends Error {
  constructor() {
    super(
      "this pod holds no AGORA_TOKEN, so it cannot write to Agora -- " +
        "check the agora-agent-token secret is mounted on the lyceum deployment",
    );
    this.name = "NoToken";
  }
}

const internal = () =>
  (process.env.AGORA_INTERNAL_URL ?? "http://agora.agents.svc.cluster.local:8081")
    .replace(/\/+$/, "");
const publicUrl = () =>
  (process.env.AGORA_URL ?? "http://agora.agents.svc.cluster.local:8080")
    .replace(/\/+$/, "");

export const personaId = () =>
  process.env.ARISTOTELES_PERSONA_ID ?? "b3333cf8-abfa-4ee3-a91b-e57fd40332ed";

/** Edvard is the only human here; Agora attributes a message by sender name,
 *  and `nova_conversations.OWNER_SENDER` uses the same literal. */
export const OWNER = "Edvard";

/** Who Lyceum's own context messages are from. Never OWNER. */
export const APP_SENDER = "Lyceum";

async function write(path: string, payload: unknown): Promise<any> {
  const token = process.env.AGORA_TOKEN ?? "";
  if (!token) throw new NoToken();
  const res = await fetch(`${internal()}${path}`, deadline(AGORA_TIMEOUT_MS, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agora-token": token },
    body: JSON.stringify(payload),
  }));
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Agora ${res.status} on ${path}`);
  }
  return body;
}

export const httpAgora: Agora = {
  async createConversation(name: string) {
    const body = await write("/conversations", { name, personaId: personaId() });
    const id = body?.conversation?.id;
    if (!id) throw new Error("Agora created a conversation without an id");
    return id;
  },

  /** `push: false` on purpose: he is looking at the thread he just typed into,
   *  and a notification about his own message is noise. Aristoteles's reply
   *  pushes through Agora's own path, not this one. */
  async postMessage(conversationId: string, text: string) {
    const body = await write(`/conversations/${conversationId}/notify`, {
      text,
      sender: OWNER,
      system: false,
      push: false,
    });
    const id = body?.message?.id;
    if (!id) throw new Error("Agora accepted the message without an id");
    return id;
  },

  async postContext(conversationId: string, text: string) {
    const body = await write(`/conversations/${conversationId}/notify`, {
      text,
      sender: APP_SENDER,
      context: true,
      push: false,
    });
    const id = body?.message?.id;
    if (!id) throw new Error("Agora accepted the context without an id");
    return id;
  },

  async messages(conversationId: string, limit: number) {
    const res = await fetch(
      `${publicUrl()}/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`,
      deadline(AGORA_TIMEOUT_MS),
    );
    if (!res.ok) throw new Error(`Agora ${res.status} reading the thread`);
    const body = (await res.json()) as { messages?: any[] };
    return visibleMessages(body.messages ?? []);
  },
};
