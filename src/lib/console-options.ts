export type ConsoleShell = "auto" | "sh" | "bash" | "command";

export type ConsoleOptions = {
  shell: ConsoleShell;
  /** Run through `sh -c` when the shell is "command". */
  command: string;
  user: string;
  workingDir: string;
};

export const DEFAULT_CONSOLE_OPTIONS: ConsoleOptions = { shell: "auto", command: "", user: "", workingDir: "" };

export const CONSOLE_SHELLS: ConsoleShell[] = ["auto", "sh", "bash", "command"];

export type ConsoleOptionField = "shell" | "command" | "user" | "workingDir";

const USER = /^[A-Za-z0-9_.@-]{1,64}(:[A-Za-z0-9_.@-]{1,64})?$/;

/** Everything comes from the browser: nothing is trusted until it has been through here. */
export function parseConsoleOptions(
  input: unknown,
): { options: ConsoleOptions } | { error: ConsoleOptionField } {
  const raw = (input ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : null);

  const shell = raw.shell === undefined ? "auto" : raw.shell;
  if (!CONSOLE_SHELLS.includes(shell as ConsoleShell)) return { error: "shell" };

  const command = text(raw.command ?? "");
  if (command === null || command.length > 1000 || command.includes("\0")) return { error: "command" };
  if (shell === "command" && command === "") return { error: "command" };

  const user = text(raw.user ?? "");
  if (user === null || (user !== "" && !USER.test(user))) return { error: "user" };

  const workingDir = text(raw.workingDir ?? "");
  if (
    workingDir === null ||
    (workingDir !== "" && (!workingDir.startsWith("/") || workingDir.length > 512 || /[\0\r\n]/.test(workingDir)))
  ) {
    return { error: "workingDir" };
  }
  return { options: { shell: shell as ConsoleShell, command, user, workingDir } };
}

export type ExecSpec = { cmd: string[]; user?: string; workingDir?: string; env: string[] };

/** Bash when the container has it, as someone typing `docker exec -ti` would try first. */
const AUTO_SHELL = "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi";

export function buildExecSpec({ shell, command, user, workingDir }: ConsoleOptions): ExecSpec {
  const cmd =
    shell === "sh" ? ["sh"] : shell === "bash" ? ["bash"] : shell === "command" ? ["sh", "-c", command] : ["sh", "-c", AUTO_SHELL];
  return {
    cmd,
    ...(user ? { user } : {}),
    ...(workingDir ? { workingDir } : {}),
    env: ["TERM=xterm-256color", "COLORTERM=truecolor"],
  };
}
