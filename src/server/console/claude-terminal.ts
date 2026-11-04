import { spawn } from "node-pty";
import { claudeArguments, claudeEnvironment } from "@/lib/claude-console";
import type { Terminal } from "./terminal";

const STOP_GRACE_MS = 2000;

export type ClaudeTarget = {
  /** Comes from the project, never from the browser. */
  cwd: string;
  sessionId: string;
  resume: boolean;
};

/** Claude itself, with no shell around it, and with the rights of whoever runs the app. */
export async function openClaudeTerminal({ cwd, sessionId, resume }: ClaudeTarget): Promise<Terminal> {
  const program = spawn("claude", claudeArguments({ id: sessionId, resume }), {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: claudeEnvironment(process.env),
  });
  let exited = false;
  let stopped = false;
  program.onExit(() => {
    exited = true;
  });

  return {
    write: (data) => program.write(data),
    resize: (cols, rows) => {
      if (exited) return;
      try {
        program.resize(cols, rows);
      } catch {
        // It ended between the check and the call.
      }
    },
    pause: () => program.pause(),
    resume: () => program.resume(),
    onData: (listener) => void program.onData((data) => listener(Buffer.from(data))),
    onExit: (listener) =>
      void program.onExit(({ exitCode }) => {
        if (!stopped) listener(exitCode);
      }),
    stop: () => {
      stopped = true;
      if (exited) return;
      // As closing a terminal window does, which lets Claude finish writing its transcript.
      program.kill("SIGHUP");
      setTimeout(() => {
        if (!exited) program.kill("SIGKILL");
      }, STOP_GRACE_MS).unref();
    },
  };
}
