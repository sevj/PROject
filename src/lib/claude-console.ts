const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isSessionId = (value: unknown): value is string => typeof value === "string" && SESSION_ID.test(value);

/**
 * Only ever these: permissions are not relaxed, and nothing from the browser is passed on
 * but a session id, checked beforehand against the sessions of the project.
 */
export function claudeArguments(session: { id: string; resume: boolean; hookFile: string }): string[] {
  return [
    ...(session.resume ? ["--resume", session.id] : ["--session-id", session.id]),
    "--settings",
    sessionHookSettings(session.hookFile),
  ];
}

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
