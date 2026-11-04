import type { RawData, WebSocket } from "ws";
import type { Terminal } from "./terminal";

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

const toBuffer = (data: RawData): Buffer =>
  Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);

/** How much unread output may pile up before the program is asked to slow down. */
const HIGH_WATER = 1 << 20;

/**
 * Binary frames are the terminal's bytes, in both directions. Text frames are control
 * messages: `resize` from the browser, `exit` and `error` from here.
 */
export function startSession(ws: WebSocket, open: () => Promise<Terminal>): void {
  const pending: { data: RawData; isBinary: boolean }[] = [];
  let terminal: Terminal | null = null;
  let size = { cols: 80, rows: 24 };
  let closed = false;

  const send = (message: object) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };

  const handle = (data: RawData, isBinary: boolean) => {
    if (isBinary) {
      terminal?.write(toBuffer(data));
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
      terminal?.resize(size.cols, size.rows);
    }
  };

  // Messages sent while the program is being opened wait for it, in order.
  ws.on("message", (data, isBinary) => (terminal ? handle(data, isBinary) : pending.push({ data, isBinary })));
  ws.on("close", () => {
    closed = true;
    terminal?.stop();
  });

  (async () => {
    try {
      const opened = await open();
      if (closed) {
        opened.stop();
        return;
      }
      terminal = opened;

      opened.onData((chunk) => {
        if (ws.readyState !== ws.OPEN) return;
        ws.send(chunk, { binary: true }, () => {
          if (ws.bufferedAmount < HIGH_WATER / 4) opened.resume();
        });
        if (ws.bufferedAmount > HIGH_WATER) opened.pause();
      });
      opened.onExit((code) => {
        if (closed) return;
        send({ type: "exit", code });
        ws.close(1000);
      });

      opened.resize(size.cols, size.rows);
      for (const { data, isBinary } of pending.splice(0)) handle(data, isBinary);
    } catch (error) {
      send({ type: "error", message: error instanceof Error ? error.message : String(error) });
      ws.close(1011);
    }
  })();
}
