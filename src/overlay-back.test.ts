import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* The phone's back button used to close an open sheet AND pop the page under
   it, and whatever had been typed into the sheet went with it (architecture
   review F-C3). An overlay now owns a history entry, so back closes the
   overlay and leaves the page alone, and a note draft is written to
   localStorage per keystroke so no way of closing the sheet can lose it.

   Nothing in this repo renders a component, so these assertions read the
   source and are a guard, not a proof. The proof is test/nav-overlay.probe.mjs,
   which drives the real app in Chromium; run it by hand (it needs a browser
   build no CI runner here has) and it reports, against this code:
     after-back {"sheet":false,"stillOnCourse":true}   draft-after-reopen "half a thought"
   and against the code before this change:
     after-back {"sheet":false,"stillOnCourse":false}  draft-after-reopen "" */

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "..", "public", "app.js"), "utf8");

describe("back closes an overlay without losing what is in it", () => {
  it("gives an open overlay its own history entry", () => {
    expect(app).toMatch(/history\.pushState\(\{\s*lyceumOverlay:\s*1\s*\}/);
    expect(app).toMatch(/const overlayOpen = talk \|\| note \|\| rename !== null;/);
  });

  it("returns from the popstate handler without popping a page", () => {
    const pop = app.slice(app.indexOf("const onPop = ()"), app.indexOf("window.addEventListener('popstate'"));
    expect(pop).toMatch(/if \(overlayArmed\.current\)/);
    expect(pop).toMatch(/closeOverlays\(\);/);
    // the early return is what keeps the page: without it, back does both
    expect(pop.slice(pop.indexOf("overlayArmed.current"))).toMatch(/return;[\s\S]*armed\.current = false;/);
  });

  it("routes every close through the history entry, so the scrim leaves no dead back press", () => {
    // no overlay is closed by setting its state straight to false in the shell
    const shell = app.slice(app.indexOf("function App()"));
    expect(shell).not.toMatch(/close=\$\{\(\) => setNote\(false\)\}/);
    expect(shell).not.toMatch(/close=\$\{\(\) => setTalk\(false\)\}/);
    expect(shell).not.toMatch(/close=\$\{\(\) => setRename\(null\)\}/);
    expect(app).toMatch(/const closeOverlay = \(\) => \{ if \(overlayArmed\.current\) history\.back\(\); else closeOverlays\(\); \};/);
  });

  it("keeps a note draft per keystroke and clears it once saved", () => {
    expect(app).toMatch(/useState\(\(\) => readDraft\(\)\)/);
    expect(app).toMatch(/onInput=\$\{\(e\) => \{ setText\(e\.target\.value\); writeDraft\(e\.target\.value\); \}\}/);
    expect(app).toMatch(/\.then\(\(\) => \{ writeDraft\(''\); onSaved\(dest\.path\); \}/);
  });
});
