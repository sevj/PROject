export type InstructionFile = { name: string; lines: number; imports: string[]; generatedByNext: boolean };

/**
 * What Claude Code does with these files: a `CLAUDE.md` takes over from `AGENTS.md` unless it
 * imports it, and `AGENTS.md` is read when there is no `CLAUDE.md`.
 * - `none`: nothing written for this project, the block `next dev` adds to AGENTS.md aside.
 * - `shadowed`: an AGENTS.md is there, and Claude does not read it.
 */
export type InstructionState = "none" | "ok" | "shadowed";

/** The text `next dev` writes into AGENTS.md, on its own, in a project that had none. */
const NEXT_MARKER = "This is NOT the Next.js you know";
const NEXT_BLOCK_LINES = 12;

export function describeInstructions(name: string, content: string): InstructionFile {
  const lines = content.split("\n").filter((line) => line.trim() !== "").length;
  return {
    name,
    lines,
    imports: [...content.matchAll(/(?:^|\s)@([\w./-]+\.md)\b/g)].map(([, path]) => path),
    generatedByNext: content.includes(NEXT_MARKER) && lines <= NEXT_BLOCK_LINES,
  };
}

const READ_BEFORE_AGENTS = new Set(["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"]);

export function instructionState(files: InstructionFile[]): InstructionState {
  const written = files.filter(({ generatedByNext, lines }) => !generatedByNext && lines > 0);
  if (written.length === 0) return "none";
  const agents = written.find(({ name }) => name === "AGENTS.md");
  const first = files.filter(({ name }) => READ_BEFORE_AGENTS.has(name));
  if (agents && first.length > 0 && !first.some(({ imports }) => imports.includes("AGENTS.md"))) return "shadowed";
  return "ok";
}
