import { describe, expect, it } from "vitest";
import { parseMemories, stripMarkers } from "./memory.js";

/** The one row that proves the marker is a thing the model actually emits.
 *  Copied verbatim off conversation da3dc350-9398-416b-b259-1c46ed03085b
 *  (2026-09-20 22:46 Oslo), which is Aristoteles's first unedited reply to a
 *  briefing. A parser tested only against text I wrote myself is a parser
 *  tested against my own guess at his formatting. */
const LIVE =
  '<memory name="workshop-project-1" description="Edvard\'s first workshop project">Edvard\'s first workshop project is a goal-setting and OKR framework, built via DSRM (problem, objectives, design, demonstration, evaluation, communication).</memory>\n\nNoted — goal-setting and OKR framework is workshop project one. When you\'re ready to start, first move is the problem statement: what\'s actually broken about OKRs as they\'re normally run, that you think you can fix?';

describe("against a real Aristoteles reply", () => {
  it("reads the memory he wrote and leaves only the prose on screen", () => {
    const [mem] = parseMemories(LIVE);
    expect(mem.name).toBe("workshop-project-1");
    expect(mem.description).toBe("Edvard's first workshop project");
    expect(mem.body).toContain("goal-setting and OKR framework");
    expect(stripMarkers(LIVE)).toMatch(/^Noted — goal-setting/);
    expect(stripMarkers(LIVE)).not.toContain("<memory");
  });
});
