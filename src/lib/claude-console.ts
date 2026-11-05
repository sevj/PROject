const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isSessionId = (value: unknown): value is string => typeof value === "string" && SESSION_ID.test(value);

/**
 * Only ever these: permissions are not relaxed, and nothing from the browser is passed on
 * but a session id, checked beforehand against the sessions of the project.
 */
export function claudeArguments(session: { id: string; resume: boolean; hookFile: string; mcpFile?: string; task?: ClaudeTask }): string[] {
  return [
    ...(session.resume ? ["--resume", session.id] : ["--session-id", session.id]),
    ...(session.mcpFile ? ["--mcp-config", session.mcpFile] : []),
    "--settings",
    sessionHookSettings(session.hookFile),
    // Last, since `--mcp-config` takes everything up to the next option.
    ...(session.task ? [CLAUDE_TASKS[session.task]] : []),
  ];
}

export type ClaudeTask = "generate" | "review";

export const isClaudeTask = (value: unknown): value is ClaudeTask => value === "generate" || value === "review";

const USE_THE_APP =
  "The project-manager MCP tools, if available, say what is known about this project from outside its folder: containers, addresses, ports, databases. Use them to check what you write.";

/** Fixed here: a button chooses one of these, and no text comes from the browser. */
export const CLAUDE_TASKS: Record<ClaudeTask, string> = {
  generate: `Write this project's instructions for Claude Code, in a CLAUDE.md at its root. Explore the project first. Keep only what is not quickly found by reading the code: the commands to build, test and run it, how the parts fit together, its conventions and its traps. No generic advice, and short. Write in the language of the project's documentation. ${USE_THE_APP} Show me the draft and wait for my approval before writing the file, and change no other file.`,
  review: `Review this project's instructions for Claude Code (CLAUDE.md, AGENTS.md and any file they import) against the project as it is now. Check that the commands and paths they mention still exist, and look for what is outdated, wrong, missing or not worth keeping. If a CLAUDE.md exists without importing an AGENTS.md, say that Claude does not read that AGENTS.md. ${USE_THE_APP} Run nothing that changes anything. List what you would change, and wait for my approval before editing.`,
};

/** Adds to the user's settings for this program only: each start of a session leaves a line. */
export function sessionHookSettings(file: string): string {
  const quoted = `'${file.replaceAll("'", `'\\''`)}'`;
  return JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: `{ cat; echo; } >> ${quoted}` }] }] },
  });
}

export type ClaudeConsoleGrant = { port: number; token: string; sessionId: string; consoleId: string };

/** A console the server is keeping, whichever page opened it. */
export type RunningClaudeConsole = {
  consoleId: string;
  projectId: number;
  projectName: string;
  sessionId: string;
  startedAt: number;
};

/** No more than the console server takes, all pages together. */
export const MAX_CLAUDE_CONSOLES = 8;

/**
 * What the app's own server runs with would otherwise reach Claude and every command it
 * starts: a build with the wrong NODE_ENV, or a Node program trying to speak on the IPC
 * channel of `next dev`.
 */
const OF_THE_SERVER = /^(npm_|NEXT_|__NEXT_|NODE_CHANNEL_|PNPM_|PM_)/;
const OF_THE_SERVER_EXACT = new Set([
  "NODE",
  "NODE_ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PORT",
  "TURBOPACK",
  "INIT_CWD",
  // Started from inside a Claude session, the app must not make this one look nested.
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  // It would turn off the transcripts, which resuming a conversation and the costs depend on.
  "CLAUDE_CODE_CHILD_SESSION",
]);

export function claudeEnvironment(from: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(from)) {
    if (value !== undefined && !OF_THE_SERVER.test(key) && !OF_THE_SERVER_EXACT.has(key)) env[key] = value;
  }
  return { ...env, TERM: "xterm-256color", COLORTERM: "truecolor" };
}
