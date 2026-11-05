import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type IPty, spawn } from "node-pty";
import { claudeArguments, claudeEnvironment, type ClaudeTask } from "@/lib/claude-console";
import { directAppHost, mcpConfig } from "../mcp/token";
import { endConsole, isSessionOpen, trackConsole } from "./claude-sessions";
import type { Terminal } from "./terminal";

const STOP_GRACE_MS = 2000;

export type ClaudeTarget = {
  /** Comes from the project, never from the browser. */
  cwd: string;
  sessionId: string;
  resume: boolean;
  task?: ClaudeTask;
  /** Where the page was asked from: see directAppHost for where this program reaches the app. */
  appHost: string;
  projectId: number;
};

/** Claude itself, with no shell around it, and with the rights of whoever runs the app. */
export async function openClaudeTerminal({ cwd, sessionId, resume, task, appHost, projectId }: ClaudeTarget): Promise<Terminal> {
  // Checked when the right to connect was given, but two could have been given at once.
  if (isSessionOpen(sessionId)) throw new Error("This conversation is already open in another console.");
  const tracked = trackConsole(sessionId);
  let program: IPty;
  try {
    // It holds a token, so never on a command line: beside the hook's file, in a folder only
    // this user can open and that goes with the program.
    const mcpFile = join(dirname(tracked.file), "mcp.json");
    writeFileSync(mcpFile, mcpConfig(directAppHost(appHost), projectId), { mode: 0o600 });
    program = spawn("claude", claudeArguments({ id: sessionId, resume, hookFile: tracked.file, mcpFile, task }), {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: claudeEnvironment(process.env),
    });
  } catch (error) {
    endConsole(tracked);
    throw error;
  }
  let exited = false;
  let stopped = false;
  program.onExit(() => {
    exited = true;
    endConsole(tracked);
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
