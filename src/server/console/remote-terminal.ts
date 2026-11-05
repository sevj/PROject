import { execFileSync } from "node:child_process";
import { closeSync, constants, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type IPty, spawn } from "node-pty";
import type { RemoteCommand } from "../remote-console";
import type { Terminal } from "./terminal";

const STOP_GRACE_MS = 2000;
const TAIL_CHARS = 500;

/** What each ending of a session with a kept password should tell the person. */
export type KeptPasswordNotes = { refused: string; unknownHostKey: string };

/**
 * sshpass says nothing itself. With a single prompt allowed, ssh usually gives up first with its
 * own 255, so a refused password is also recognized by what ssh printed.
 */
export function keptPasswordNote(code: number, tail: string, notes: KeptPasswordNotes): string | null {
  if (code === 5 || (code === 255 && /permission denied/i.test(tail))) return notes.refused;
  return code === 6 ? notes.unknownHostKey : null;
}

/**
 * A kept password reaches sshpass through a named pipe: it stays in the kernel until read, so
 * nothing on disk holds it, and unlike the environment it is not visible for the whole session.
 * The other end stays open until then, since a pipe nobody holds forgets what it was given.
 */
export function openPasswordPipe(password: string): { path: string; close: () => void } {
  const folder = mkdtempSync(join(tmpdir(), "pm-ssh-"));
  const path = join(folder, "password");
  let descriptor: number | null = null;
  const close = () => {
    if (descriptor !== null) closeSync(descriptor);
    descriptor = null;
    rmSync(folder, { recursive: true, force: true });
  };
  try {
    execFileSync("mkfifo", ["-m", "600", path]);
    // Read and write, and without waiting: no reader is there yet, and it must not block the app.
    descriptor = openSync(path, constants.O_RDWR | constants.O_NONBLOCK);
    writeSync(descriptor, `${password}\n`);
  } catch (error) {
    close();
    throw error;
  }
  return { path, close };
}

/** ssh or kubectl with no shell around them, with the rights and the keys of whoever runs the app. */
export async function openRemoteTerminal({ program: name, args, password }: RemoteCommand, notes: KeptPasswordNotes): Promise<Terminal> {
  const pipe = password === undefined ? null : openPasswordPipe(password);
  let program: IPty;
  try {
    program = spawn(pipe ? "sshpass" : name, pipe ? ["-f", pipe.path, name, ...args] : args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: tmpdir(),
      env: process.env as Record<string, string>,
    });
  } catch (error) {
    pipe?.close();
    throw error;
  }
  let exited = false;
  let stopped = false;
  let tail = "";
  const dataListeners: ((data: Buffer) => void)[] = [];
  program.onData((data) => {
    tail = (tail + data).slice(-TAIL_CHARS);
    for (const listener of dataListeners) listener(Buffer.from(data));
  });
  program.onExit(() => {
    exited = true;
    pipe?.close();
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
    onData: (listener) => void dataListeners.push(listener),
    onExit: (listener) =>
      void program.onExit(({ exitCode }) => {
        if (stopped) return;
        const note = pipe ? keptPasswordNote(exitCode, tail, notes) : null;
        if (note) for (const send of dataListeners) send(Buffer.from(`\r\n${note}\r\n`));
        listener(exitCode);
      }),
    stop: () => {
      stopped = true;
      if (exited) return;
      program.kill("SIGHUP");
      setTimeout(() => {
        if (!exited) program.kill("SIGKILL");
      }, STOP_GRACE_MS).unref();
    },
  };
}
