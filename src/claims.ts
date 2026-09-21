/** Anchoring a claim atom to the paragraph it was drawn from -- build step 7,
 * the app's half.
 *
 * The spec's approved design puts a GRADE mark **inline, immediately after the
 * claim**, "the way a citation marker sits at the end of a sentence". That
 * needs one thing the claim documents do not carry: where in the chapter the
 * claim came from. `tools.lyceum_claims` records the claim's text, its source
 * and its grade, and nothing about its position.
 *
 * The obvious fix -- look the claim text up in the body -- does not work on its
 * own. Measured against the 2,607 claims in the live database, only 76% of
 * claim texts appear in their chapter verbatim; the extractor paraphrases, and
 * joins across sentences. What does work is anchoring to a **paragraph** rather
 * than to a character offset, and accepting a prefix rather than the whole
 * claim: 2,599 of those 2,607 (99.7%) land in exactly one paragraph that way.
 *
 * The rule throughout is that an ambiguous anchor is no anchor. A fragment that
 * matches two paragraphs is discarded rather than resolved to the first one,
 * because a mark under the wrong paragraph is worse than a missing mark -- it
 * attributes a source trace to text that did not produce it. The eight claims
 * that never resolve come back with `paragraph: null` and the reading view
 * lists them under the chapter instead of guessing.
 */

/** Markdown emphasis and whitespace differ between the claim and the body; the
 * words do not. Strip the first, collapse the second, compare the rest. */
export function normalise(text: string): string {
  return text
    .replace(/\*\*|\*|`|_/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The shortest fragment we will trust. Below this, a match is a coincidence
 * rather than a citation -- "the most common and easiest form of" is a phrase
 * that could sit in any paragraph of a course about analytics. */
const MIN_FRAGMENT = 40;

/** How much to give up per attempt when the whole claim does not match. */
const STEP = 20;

function uniqueParagraph(paragraphs: string[], fragment: string): number | null {
  let found: number | null = null;
  for (let i = 0; i < paragraphs.length; i += 1) {
    if (!paragraphs[i].includes(fragment)) continue;
    if (found !== null) return null; // ambiguous: two paragraphs, no anchor
    found = i;
  }
  return found;
}

/** Split a chapter body the same way the reading view does.
 *
 * This has to stay identical to `app.js`'s own split, because the index this
 * module returns is an index into *that* array. Blank entries are kept rather
 * than filtered for exactly that reason -- dropping one here would shift every
 * mark after it by a paragraph on the screen.
 */
export function paragraphsOf(body: string): string[] {
  return body.split(/\n{2,}/);
}

export type AnchorableClaim = { text?: string | null };

/** The paragraph index a claim belongs under, or null if it cannot be placed. */
export function anchorClaim(paragraphs: string[], claim: AnchorableClaim): number | null {
  const text = normalise(claim.text ?? "");
  if (text.length < MIN_FRAGMENT) return null;
  const normalised = paragraphs.map(normalise);

  // A leading fragment of the claim, shortened until it matches one paragraph.
  for (let length = text.length; length >= MIN_FRAGMENT; length -= STEP) {
    const hit = uniqueParagraph(normalised, text.slice(0, length));
    if (hit !== null) return hit;
  }

  // Failing that, any one sentence of it -- a claim that joins two sentences
  // from different paragraphs still names one of them exactly.
  for (const sentence of text.split(/(?<=[.!?]) /)) {
    if (sentence.length < MIN_FRAGMENT) continue;
    const hit = uniqueParagraph(normalised, sentence);
    if (hit !== null) return hit;
  }

  return null;
}
