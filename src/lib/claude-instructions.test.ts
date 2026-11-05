import { describe, expect, it } from "vitest";
import { describeInstructions, instructionState } from "./claude-instructions";

const text = (lines: number) => Array.from({ length: lines }, (_, index) => `line ${index}`).join("\n");
const next = "## This is NOT the Next.js you know\n\nRead the docs.\n";

describe("describeInstructions", () => {
  it("counts the written lines and finds the imports", () => {
    expect(describeInstructions("CLAUDE.md", "# Title\n\nSee @AGENTS.md and @docs/a.md, not a@b.md\n")).toEqual({
      name: "CLAUDE.md",
      lines: 2,
      imports: ["AGENTS.md", "docs/a.md"],
      generatedByNext: false,
    });
  });

  it("tells the block of Next from a file that also holds it", () => {
    expect(describeInstructions("AGENTS.md", next).generatedByNext).toBe(true);
    expect(describeInstructions("AGENTS.md", `${next}${text(40)}`).generatedByNext).toBe(false);
  });
});

describe("instructionState", () => {
  const file = (name: string, content: string) => describeInstructions(name, content);

  it("sees nothing in no file, an empty one, or only the block of Next", () => {
    expect(instructionState([])).toBe("none");
    expect(instructionState([file("CLAUDE.md", "\n\n")])).toBe("none");
    expect(instructionState([file("AGENTS.md", next)])).toBe("none");
  });

  it("is fine with either file alone, or with one importing the other", () => {
    expect(instructionState([file("CLAUDE.md", text(5))])).toBe("ok");
    expect(instructionState([file("AGENTS.md", text(5))])).toBe("ok");
    expect(instructionState([file("CLAUDE.md", "@AGENTS.md"), file("AGENTS.md", text(5))])).toBe("ok");
    expect(instructionState([file("CLAUDE.md", text(5)), file("AGENTS.md", next)])).toBe("ok");
  });

  it("warns of an AGENTS.md that a CLAUDE.md hides, a personal one included", () => {
    expect(instructionState([file("CLAUDE.md", text(5)), file("AGENTS.md", text(5))])).toBe("shadowed");
    expect(instructionState([file("CLAUDE.local.md", text(1)), file("AGENTS.md", text(5))])).toBe("shadowed");
  });
});
