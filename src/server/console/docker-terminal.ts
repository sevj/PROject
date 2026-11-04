import { randomBytes } from "node:crypto";
import { buildExecSpec, type ConsoleOptions } from "@/lib/console-options";
import { createExec, endSession, inspectExec, resizeExec, startExec } from "./docker-exec";
import { dockerSocketPath } from "./docker-socket";
import type { Terminal } from "./terminal";

async function exitCodeOf(socketPath: string, execId: string): Promise<number | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const { running, exitCode } = await inspectExec(socketPath, execId);
      if (!running) return exitCode;
    } catch {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

export async function openDockerTerminal(containerId: string, options: ConsoleOptions): Promise<Terminal> {
  const marker = `PM_CONSOLE_SESSION=${randomBytes(12).toString("hex")}`;
  const socketPath = await dockerSocketPath();
  const spec = buildExecSpec(options);
  const execId = await createExec(socketPath, containerId, { ...spec, env: [...spec.env, marker] });
  const stream = await startExec(socketPath, execId);
  let stopped = false;
  stream.on("error", () => stream.destroy());

  return {
    write: (data) => void stream.write(data),
    resize: (cols, rows) => void resizeExec(socketPath, execId, cols, rows).catch(() => undefined),
    pause: () => void stream.pause(),
    resume: () => void stream.resume(),
    onData: (listener) => void stream.on("data", listener),
    onExit: (listener) =>
      void stream.on("close", async () => {
        if (!stopped) listener(await exitCodeOf(socketPath, execId));
      }),
    stop: () => {
      stopped = true;
      stream.destroy();
      // A program that has already finished needs nothing, which is also what asking Docker tells us.
      void (async () => {
        try {
          if ((await inspectExec(socketPath, execId)).running) await endSession(socketPath, containerId, marker);
        } catch {
          // Docker being gone takes the program with it, or there is nothing more to try.
        }
      })();
    },
  };
}
