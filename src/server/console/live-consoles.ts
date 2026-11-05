import type { WebSocket } from "ws";
import { parseTerminalMessage, toBuffer } from "./session";
import type { Terminal } from "./terminal";

/** Enough to find the conversation again on screen, without keeping everything it ever said. */
const OUTPUT_LIMIT = 4 << 20;

/** How much unread output may pile up before the program is asked to slow down. */
const HIGH_WATER = 1 << 20;

/** Nobody came back for a day: it must not run forever on a tab closed and forgotten. */
export const DETACHED_GRACE_MS = 24 * 3600_000;

export const REPLACED_CLOSE_CODE = 4000;

/** Whole chunks only: a program writes a control sequence at once, so none is cut in half. */
export function outputBuffer(limit = OUTPUT_LIMIT) {
  const chunks: Buffer[] = [];
  let size = 0;
  return {
    push(chunk: Buffer) {
      chunks.push(chunk);
      size += chunk.length;
      while (size > limit && chunks.length > 1) size -= chunks.shift()?.length ?? 0;
    },
    all: () => [...chunks],
  };
}

export type LiveConsoleStart = {
  id: string;
  projectId: number;
  projectName: string;
  /** The conversation it started on, which `/clear` may have replaced since. */
  sessionId: string;
  startedAt: number;
};

type Live = LiveConsoleStart & {
  terminal: Terminal;
  output: ReturnType<typeof outputBuffer>;
  socket: WebSocket | null;
  size: { cols: number; rows: number };
  timer: NodeJS.Timeout | null;
};

// Kept on globalThis so that a hot reload in dev does not lose what is running.
const holder = globalThis as unknown as {
  __pmLiveConsoles?: Map<string, Live>;
  __pmLiveStarting?: Map<string, Promise<Live>>;
};
const ready = () => (holder.__pmLiveConsoles ??= new Map());
const starting = () => (holder.__pmLiveStarting ??= new Map());

function start(info: LiveConsoleStart, open: () => Promise<Terminal>): Promise<Live> {
  const opening = open().then((terminal) => {
    const live: Live = { ...info, terminal, output: outputBuffer(), socket: null, size: { cols: 80, rows: 24 }, timer: null };
    terminal.onData((chunk) => {
      live.output.push(chunk);
      const { socket } = live;
      if (socket?.readyState !== socket?.OPEN || !socket) return;
      socket.send(chunk, { binary: true }, () => {
        if (socket.bufferedAmount < HIGH_WATER / 4) terminal.resume();
      });
      if (socket.bufferedAmount > HIGH_WATER) terminal.pause();
    });
    terminal.onExit((code) => {
      if (live.timer) clearTimeout(live.timer);
      ready().delete(live.id);
      const { socket } = live;
      if (socket?.readyState === socket?.OPEN && socket) {
        socket.send(JSON.stringify({ type: "exit", code }));
        socket.close(1000);
      }
    });
    ready().set(info.id, live);
    starting().delete(info.id);
    return live;
  });
  opening.catch(() => starting().delete(info.id));
  starting().set(info.id, opening);
  return opening;
}

function stop(live: Live): void {
  if (live.timer) clearTimeout(live.timer);
  ready().delete(live.id);
  live.socket?.close(1000);
  live.socket = null;
  live.terminal.stop();
}

function detach(live: Live, graceMs: number): void {
  live.socket = null;
  // Nobody reads now: what comes is kept in the buffer, so the program has no reason to wait.
  live.terminal.resume();
  if (live.timer) clearTimeout(live.timer);
  live.timer = setTimeout(() => stop(live), graceMs);
  live.timer.unref?.();
}

/** Whoever connects takes the console over: the page that had it is told, and does not fight back. */
function attach(live: Live, ws: WebSocket): void {
  if (live.timer) clearTimeout(live.timer);
  live.timer = null;
  const previous = live.socket;
  live.socket = ws;
  if (previous) {
    previous.send(JSON.stringify({ type: "replaced" }));
    previous.close(REPLACED_CLOSE_CODE);
  }
  // Between the two, a terminal answers the questions found in this old output: nobody is asking anymore.
  ws.send(JSON.stringify({ type: "replay-start" }));
  for (const chunk of live.output.all()) ws.send(chunk, { binary: true });
  ws.send(JSON.stringify({ type: "replay-end" }));
  live.terminal.resume();
}

/**
 * The program belongs to the server, not to this connection. Closing it leaves the program
 * running, for the next connection with the same id to take over.
 */
export function joinLiveConsole(
  ws: WebSocket,
  info: LiveConsoleStart,
  open: () => Promise<Terminal>,
  graceMs = DETACHED_GRACE_MS,
): void {
  const pending: { data: Parameters<typeof toBuffer>[0]; isBinary: boolean }[] = [];
  let live: Live | null = null;
  let closed = false;

  const handle = (target: Live, data: Parameters<typeof toBuffer>[0], isBinary: boolean) => {
    if (target.socket !== ws) return;
    if (isBinary) {
      target.terminal.write(toBuffer(data));
      return;
    }
    const resized = parseTerminalMessage(data, target.size);
    if (resized) {
      target.size = resized;
      target.terminal.resize(resized.cols, resized.rows);
    }
  };

  ws.on("message", (data, isBinary) => (live ? handle(live, data, isBinary) : pending.push({ data, isBinary })));
  ws.on("close", () => {
    closed = true;
    if (live?.socket === ws) detach(live, graceMs);
  });

  (async () => {
    try {
      const target = ready().get(info.id) ?? (await (starting().get(info.id) ?? start(info, open)));
      // It may have been started for a connection that is gone by now: it waits like any other.
      if (closed) {
        if (!target.socket) detach(target, graceMs);
        return;
      }
      live = target;
      attach(target, ws);
      for (const { data, isBinary } of pending.splice(0)) handle(target, data, isBinary);
    } catch (error) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }));
      ws.close(1011);
    }
  })();
}

export type LiveConsole = LiveConsoleStart & { attached: boolean };

const describeLive = ({ id, projectId, projectName, sessionId, startedAt, socket }: Live): LiveConsole => ({
  id,
  projectId,
  projectName,
  sessionId,
  startedAt,
  attached: socket !== null,
});

export const listLiveConsoles = (): LiveConsole[] => [...ready().values()].map(describeLive);

export const liveConsole = (id: string): LiveConsole | null => {
  const live = ready().get(id);
  return live ? describeLive(live) : null;
};

export const liveConsoleCount = () => ready().size + starting().size;

/** Ending a console is a decision of the user's: leaving the page is not. */
export function stopLiveConsole(id: string): void {
  const live = ready().get(id);
  if (live) stop(live);
  else void starting().get(id)?.then(stop, () => undefined);
}
