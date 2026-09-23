import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* The approved demo is the design for this app. The owner built the whole UI
   himself and the first real build replaced it rather than porting it, which
   he reported. The promise made then -- "a Lyceum UI change gets checked
   against the demo screen by screen before it merges" -- lived only in a
   comment on a board item until now. This is that promise as a check.

   demo/app.js is a copy of /data/workspace/demos/lyceum/app.js, vendored so
   this runs in CI, where that path does not exist.

   One-directional on purpose: every control the demo has, the real app must
   have. Extra controls in the real app are fine -- it has a backend and real
   data and the demo has neither. */

const here = dirname(fileURLToPath(import.meta.url));
const demo = readFileSync(join(here, "..", "demo", "app.js"), "utf8");
const real = readFileSync(join(here, "..", "public", "app.js"), "utf8");

/* Every quoted string handed to the icon helper I(...), including the ternary
   forms -- I(saved ? 'check' : 'note_add') contributes both names. Matching
   I('x') alone silently passes an icon the demo renders conditionally, which
   is how my own hand-check of this missed nine of the demo's twenty-one. */
function icons(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/\bI\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
    for (const s of m[1].matchAll(/'([a-z][a-z_0-9]{2,30})'/g)) out.add(s[1]);
  }
  return out;
}

/* Template interpolations, brace-balanced. A non-greedy /\$\{.*?\}/ ends at
   the first closing brace, which inside these files is usually an arrow-
   function body -- it leaves handler source in the label text and every label
   then looks unique, so the comparison passes while comparing garbage. */
function stripInterpolations(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "$" && src[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        i++;
      }
      out += " ";
    } else out += src[i++];
  }
  return out;
}

/* The words on a button. Course titles and claim text are demo fixtures that
   real data replaces, so they are not controls and are not compared. */
function buttonLabels(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of stripInterpolations(src).matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
    const label = m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (label && /^[A-Za-z]/.test(label)) out.add(label);
  }
  return out;
}

/* A control the real app deliberately does not carry. Each entry says why.
   Adding a name here is a decision someone takes on purpose; leaving one out
   is this check doing its job. */
const EXEMPT: Record<string, string> = {
  "icon:edit":
    "Only use is the Edit button below, which is exempt for the same reason.",
  "label:Edit":
    "The demo's file viewer has an Edit button with no handler -- the demo has no backend. " +
    "Writing a workshop file back is a feature, not a port, and a button that does nothing " +
    "is the interim UI the owner has asked me not to ship. Board it before exempting it again.",
  "label:Discuss these":
    "Ends the practice review sheet in the demo, where it only closes the sheet. The real app " +
    "has discussions, so wiring it means deciding what the discussion is about (the questions " +
    "missed, presumably) and opening one -- a feature, not a port.",
};

describe("the live app carries every control of the approved demo", () => {
  it("has every icon the demo uses", () => {
    const real_ = icons(real);
    const missing = [...icons(demo)].filter((n) => !real_.has(n) && !(`icon:${n}` in EXEMPT));
    expect(missing, `icons in the demo but not in public/app.js: ${missing.join(", ")}`).toEqual([]);
  });

  it("has every button the demo has", () => {
    const real_ = buttonLabels(real);
    const missing = [...buttonLabels(demo)].filter((l) => !real_.has(l) && !(`label:${l}` in EXEMPT));
    expect(missing, `buttons in the demo but not in public/app.js: ${missing.join(", ")}`).toEqual([]);
  });

  it("every exemption gives a reason", () => {
    for (const [name, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${name} needs a real reason, not a placeholder`).toBeGreaterThan(40);
    }
  });

  it("no exemption outlives the control it excuses", () => {
    for (const name of Object.keys(EXEMPT)) {
      const [kind, value] = [name.slice(0, name.indexOf(":")), name.slice(name.indexOf(":") + 1)];
      const present = kind === "icon" ? icons(demo).has(value) : buttonLabels(demo).has(value);
      expect(present, `${name} is exempt but the demo no longer has it -- delete the entry`).toBe(true);
    }
  });

  it("reads a whole demo, not a truncated one", () => {
    // An empty or half-copied fixture makes both checks above pass on nothing.
    expect(demo.length).toBeGreaterThan(50_000);
    expect(icons(demo).size).toBeGreaterThan(15);
    expect(buttonLabels(demo).size).toBeGreaterThan(5);
  });
});

/* Controls are what a screen has; navigation is what it does, and the checks
   above cannot see it. The owner asked for the demo's navigation by name
   (issue #268): "swiping right on any inner page slides it off to uncover the
   page underneath, and the phone back button pops one page without leaving the
   app". The port landed, and nothing guarded it -- the whole nav stack could be
   deleted from public/app.js and all 102 tests above would still pass.

   Same one-directional shape as the controls: each row names one piece of the
   demo's navigation, and the real app must carry it whenever the demo does.
   Anchored on the demo rather than hardcoded so that a demo which drops a piece
   stops demanding it, the way an exemption does. */
const NAV: [string, RegExp][] = [
  ["a popstate listener, so the phone's back button is handled at all",
    /addEventListener\(\s*['"]popstate['"]/],
  ["one history entry pushed while the stack is deep, so back has something to pop",
    /history\.pushState\(/],
  ["back() going through history.back(), so the gesture and the button pop the same way",
    /history\.back\(\)/],
  ["a stack popped by one entry, not reset to the tab",
    /s\.length > 1 \? s\.slice\(0, ?-1\) : s/],
  ["touch handlers on the stage, so the gesture works anywhere on the page",
    /onTouchStart=\$\{[^}]+\}[\s\S]{0,120}?onTouchMove=/],
  ["a cancelled touch treated as an end, so a lifted finger never leaves a page half-slid",
    /onTouchCancel=/],
  ["an axis lock, so a vertical scroll does not start a back-swipe",
    /Math\.abs\(mx\) > Math\.abs\(my\)/],
  ["right-only travel -- a leftward drag must not move the page",
    /Math\.max\(0, ?mx\)/],
  ["a distance-or-speed threshold, so a short drag springs back",
    /d\.dx > W\(\) \* 0\.33 \|\| speed > 0\.6/],
  ["the page under the top one drawn behind it, so something is uncovered",
    /under \? page\(under,/],
  ["the top page translated by the drag, which is the slide itself",
    /transform: ?dx \? `translateX\(\$\{dx\}px\)`/],
];

describe("navigation matches the approved demo (issue #268)", () => {
  it.each(NAV)("public/app.js has %s", (_what, pattern) => {
    expect(pattern.test(real)).toBe(true);
  });

  /* The rule this file already lives by, applied to itself: a probe that cannot
     match anything has a guaranteed negative, and eleven guaranteed negatives
     read exactly like eleven passing checks. Each pattern must find the demo
     too, or it is measuring nothing and the row above is decoration. */
  it("every pattern above still matches the demo it was taken from", () => {
    const dead = NAV.filter(([, p]) => !p.test(demo)).map(([what]) => what);
    expect(dead, `patterns that no longer match demo/app.js: ${dead.join("; ")}`).toEqual([]);
  });
});
