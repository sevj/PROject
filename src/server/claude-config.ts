import { lstat, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { describeInstructions, type InstructionFile, instructionState, type InstructionState } from "@/lib/claude-instructions";

const INSTRUCTION_FILES = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"];
const MAX_FILE_BYTES = 1 << 20;

export type ClaudeConfig = {
  instructions: (InstructionFile & { content: string })[];
  state: InstructionState;
  /** Names only: these files can hold tokens, and a command says more than it should. */
  mcpServers: string[];
  hooks: string[];
  skills: string[];
  agents: string[];
  commands: string[];
  rules: string[];
  memories: number;
};

/** Symlinks are refused, as for every file read in a project: they could point anywhere. */
async function readText(path: string): Promise<string | null> {
  try {
    const stat = await lstat(path);
    return stat.isFile() && stat.size <= MAX_FILE_BYTES ? await readFile(path, "utf8") : null;
  } catch {
    return null;
  }
}

async function readObject(path: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse((await readText(path)) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const namesIn = async (folder: string): Promise<string[]> => {
  try {
    return (await readdir(folder)).filter((name) => !name.startsWith(".")).sort();
  } catch {
    return [];
  }
};

const keysOf = (value: unknown): string[] => (value && typeof value === "object" ? Object.keys(value) : []);

/** Where Claude Code keeps what it learned about this folder. */
export function memoryFolder(projectPath: string, configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")): string {
  return join(configDir, "projects", projectPath.replace(/[^a-zA-Z0-9]/g, "-"), "memory");
}

export async function readClaudeConfig(projectPath: string): Promise<ClaudeConfig> {
  const read = await Promise.all(INSTRUCTION_FILES.map(async (name) => ({ name, content: await readText(join(projectPath, name)) })));
  const instructions = read.flatMap(({ name, content }) => (content === null ? [] : [{ ...describeInstructions(name, content), content }]));
  const claude = join(projectPath, ".claude");
  const [mcp, settings, local, skills, agents, commands, rules, memories] = await Promise.all([
    readObject(join(projectPath, ".mcp.json")),
    readObject(join(claude, "settings.json")),
    readObject(join(claude, "settings.local.json")),
    namesIn(join(claude, "skills")),
    namesIn(join(claude, "agents")),
    namesIn(join(claude, "commands")),
    namesIn(join(claude, "rules")),
    namesIn(memoryFolder(projectPath)),
  ]);
  return {
    instructions,
    state: instructionState(instructions),
    mcpServers: keysOf(mcp.mcpServers),
    hooks: [...new Set([...keysOf(settings.hooks), ...keysOf(local.hooks)])],
    skills,
    agents,
    commands,
    rules,
    memories: memories.filter((name) => name.endsWith(".md") && name !== "MEMORY.md").length,
  };
}
