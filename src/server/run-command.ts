import { spawn } from "node:child_process";

export type Ran = { code: number | null; stdout: string; stderr: string; notInstalled: boolean };
export type CommandRunner = (command: string, args: string[], secret?: string, timeoutMs?: number) => Promise<Ran>;

const DEFAULT_TIMEOUT_MS = 20_000;
/** Enough for the pods of a whole namespace as JSON: cut, they could not be read at all. */
const OUTPUT_LIMIT = 16 * 1024 * 1024;

/**
 * A secret goes through a pipe of its own, descriptor 3: on a command line or in the environment,
 * `ps` or /proc would show it. Nothing can be typed in: stdin is closed.
 */
export const runCommand: CommandRunner = (command, args, secret, timeoutMs = DEFAULT_TIMEOUT_MS) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: secret === undefined ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "pipe", "pipe"],
      timeout: timeoutMs,
      env: { ...process.env, LC_ALL: "C" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-OUTPUT_LIMIT); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-OUTPUT_LIMIT); });
    if (secret !== undefined) {
      const pipe = child.stdio[3] as NodeJS.WritableStream;
      // The child may be gone before it reads: its exit code tells more than this error.
      pipe.on("error", () => undefined);
      pipe.end(`${secret}\n`);
    }
    let notInstalled = false;
    child.once("error", (error: NodeJS.ErrnoException) => {
      notInstalled = error.code === "ENOENT";
      if (notInstalled) resolve({ code: 127, stdout, stderr, notInstalled });
    });
    child.once("close", (code, signal) => resolve({ code: signal ? null : code, stdout, stderr, notInstalled }));
  });
