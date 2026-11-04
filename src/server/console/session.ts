import { randomBytes } from "node:crypto";
import type { Duplex } from "node:stream";
import type { RawData, WebSocket } from "ws";
import { buildExecSpec } from "@/lib/console-options";
import { createExec, endSession, inspectExec, resizeExec, startExec } from "./docker-exec";
import { dockerSocketPath } from "./docker-socket";
import type { Grant } from "./grants";

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

const toBuffer = (data: RawData): Buffer =>
  Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);

/** How much unread output may pile up before Docker is asked to slow down. */
const HIGH_WATER = 1 << 20;

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

/**
 * Binary frames are the terminal's bytes, in both directions. Text frames are control
 * messages: `resize` from the browser, `exit` and `error` from here.
 */
export function startSession(ws: WebSocket, grant: Grant): void {
  const pending: { data: RawData; isBinary: boolean }[] = [];
  let stream: Duplex | null = null;
  let socketPath = "";
  let execId = "";
  let size = { cols: 80, rows: 24 };
  let closed = false;
  const marker = `PM_CONSOLE_SESSION=${randomBytes(12).toString("hex")}`;

  // The browser is gone: what it was running must not outlive it. A program that has
  // already finished needs nothing, which is also what asking Docker tells us.
  const endProgram = async () => {
    if (!execId) return;
    try {
      if ((await inspectExec(socketPath, execId)).running) await endSession(socketPath, grant.containerId, marker);
    } catch {
      // Docker being gone takes the program with it, or there is nothing more to try.
    }
  };

  const send = (message: object) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };

  const handle = (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      stream?.write(toBuffer(data));
      return;
    }
    let message: { type?: string; cols?: unknown; rows?: unknown };
    try {
      message = JSON.parse(toBuffer(data).toString());
    } catch {
      return;
    }
    if (message?.type === "resize") {
      size = { cols: clamp(message.cols, 2, 500, size.cols), rows: clamp(message.rows, 1, 200, size.rows) };
      if (execId) resizeExec(socketPath, execId, size.cols, size.rows).catch(() => undefined);
    }
  };

  // Messages sent while the shell is being opened wait for it, in order.
  ws.on("message", (data, isBinary) => (stream ? handle(data, isBinary) : pending.push({ data, isBinary })));
  ws.on("close", () => {
    closed = true;
    stream?.destroy();
    void endProgram();
  });

  (async () => {
    try {
      socketPath = await dockerSocketPath();
      const spec = buildExecSpec(grant.options);
      execId = await createExec(socketPath, grant.containerId, { ...spec, env: [...spec.env, marker] });
      const opened = await startExec(socketPath, execId);
      if (closed) {
        opened.destroy();
        void endProgram();
        return;
      }
      stream = opened;

      opened.on("data", (chunk: Buffer) => {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(chunk, { binary: true }, () => {
          if (ws.bufferedAmount < HIGH_WATER / 4) opened.resume();
        });
        if (ws.bufferedAmount > HIGH_WATER) opened.pause();
      });
      opened.on("close", async () => {
        if (closed) return;
        send({ type: "exit", code: await exitCodeOf(socketPath, execId) });
        ws.close(1000);
      });
      opened.on("error", () => opened.destroy());

      await resizeExec(socketPath, execId, size.cols, size.rows).catch(() => undefined);
      for (const { data, isBinary } of pending.splice(0)) handle(data, isBinary);
    } catch (error) {
      send({ type: "error", message: error instanceof Error ? error.message : String(error) });
      ws.close(1011);
    }
  })();
}
