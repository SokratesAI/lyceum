/** Every outbound call this process makes gets a deadline (issue #277).
 *
 * `fetch` has none by default: if CouchDB or Agora accepts the connection and
 * then stops answering, the request handler waiting on it never returns, the
 * client sees a page stuck on "Loading…", and the socket is held until the pod
 * restarts. These are all short database and API calls -- no streaming, and no
 * model call happens inside this process -- so a deadline in seconds is
 * generous rather than tight.
 */

/** CouchDB: the vault and the lyceum database, on the same cluster network. */
export const DB_TIMEOUT_MS = 15_000;

/** Agora: one hop further, and it writes as well as reads. */
export const AGORA_TIMEOUT_MS = 20_000;

/** Merge a deadline into `fetch` options. `AbortSignal.timeout` aborts with a
 *  `TimeoutError`, so a deadline that fires is distinguishable from a caller
 *  that gave up. */
export function deadline(ms: number, init: RequestInit = {}): RequestInit {
  return { ...init, signal: AbortSignal.timeout(ms) };
}
