import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* Practice answers used to be posted once, when the deck ran out. Anything
   that ended a session early -- the back button, the phone ringing, the tab
   being dropped -- threw every answer in it away, and on a phone that is most
   sessions. They are now posted as each card is answered, and carry an id so a
   re-send cannot file the same answer twice.

   Nothing in this repo renders a component, so these assertions read the
   source and are a guard, not a proof. The proof is
   test/practice-report.probe.mjs, which drives the real app in Chromium with
   the API stubbed; run it by hand (it needs a browser build no CI runner here
   has) and it reports, against this code:
     after-1-of-3 {"posted":1,"answers":1}   every-answer-landed {"tried":3,"landed":3}
   and against the code before this change:
     after-1-of-3 {"posted":0,"answers":0}   no-duplicate-ids false          */

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "..", "public", "app.js"), "utf8");
const start = app.indexOf("const sent = useRef(0)");
const effect = app.slice(start, app.indexOf("if (loading) return html", start));

describe("a practice answer is reported before the deck ends", () => {
  it("does not wait for the session to be over", () => {
    expect(effect).toContain("postJSON('/api/practice/answers'");
    // `over` is what gated the old post; it must not gate this one.
    expect(effect).not.toMatch(/if \(!over/);
    expect(effect).toMatch(/\}, \[log\]\);/);
  });

  it("counts what landed rather than latching after one attempt", () => {
    // A boolean latch is the old shape: one post ever, and a failure was final.
    expect(app).toContain("const sent = useRef(0)");
    expect(effect).toContain("if (sent.current >= log.length) return;");
    expect(effect).toContain("log.slice(sent.current)");
    // Only a resolved post may advance it, or a failure would be forgotten.
    expect(effect).toMatch(/\.then\(\(\) => \{ sent\.current = Math\.max\(sent\.current, upto\); \}\)/);
    expect(effect).toContain(".catch(() => {})");
  });

  it("gives every answer an id the server can dedupe on", () => {
    expect(app).toMatch(/const record = \(result\) => setLog\(\(l\) => \[\.\.\.l, \{ cardId: c\.id, result, answerId: answerId\(\) \}\]\);/);
    // The id must match the server's ANSWER_ID pattern, so no raw text in it.
    expect(app).toMatch(/const answerId = \(\) => `\$\{Date\.now\(\)\.toString\(36\)\}-\$\{\(answerSeq \+= 1\)\.toString\(36\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2, 8\)\}`;/);
  });
});
