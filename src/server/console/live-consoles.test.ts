import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  joinLiveConsole,
  listLiveConsoles,
  liveConsole,
  type LiveConsoleStart,
  outputBuffer,
  REPLACED_CLOSE_CODE,
  stopLiveConsole,
} from "./live-consoles";
import type { Terminal } from "./terminal";

class FakeSocket extends EventEmitter {
  OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent: (string | Buffer)[] = [];
  closedWith: number | null = null;
  send(data: string | Buffer, _options?: unknown, done?: () => void) {
    this.sent.push(data);
    done?.();
  }
  close(code: number) {
    this.closedWith = code;
    this.readyState = 3;
    this.emit("close", code);
  }
  bytes = () => this.sent.filter((item) => Buffer.isBuffer(item)).join("");
  messages = () => this.sent.filter((item) => typeof item === "string").map((item) => JSON.parse(item as string).type);
}

function fakeTerminal() {
  const listeners: { data?: (chunk: Buffer) => void; exit?: (code: number | null) => void } = {};
  const typed: string[] = [];
  const sizes: number[][] = [];
  const stop = vi.fn();
  const terminal: Terminal = {
    write: (data) => void typed.push(data.toString()),
    resize: (cols, rows) => void sizes.push([cols, rows]),
    pause: () => undefined,
    resume: () => undefined,
    onData: (listener) => void (listeners.data = listener),
    onExit: (listener) => void (listeners.exit = listener),
    stop,
  };
  return {
    terminal,
    typed,
    sizes,
    stop,
    say: (text: string) => listeners.data?.(Buffer.from(text)),
    exit: (code: number) => listeners.exit?.(code),
  };
}

let nextId = 0;
const info = (): LiveConsoleStart => {
  nextId += 1;
  return { id: `c${nextId}`, projectId: 1, projectName: "p", sessionId: `s${nextId}`, startedAt: 5 };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function join(start: LiveConsoleStart, open: () => Promise<Terminal>, graceMs?: number) {
  const socket = new FakeSocket();
  joinLiveConsole(socket as unknown as WebSocket, start, open, graceMs);
  await settle();
  return socket;
}

afterEach(() => {
  for (const { id } of listLiveConsoles()) stopLiveConsole(id);
  vi.useRealTimers();
});

describe("outputBuffer", () => {
  it("forgets the oldest chunks past its limit, and never the last one", () => {
    const buffer = outputBuffer(4);
    buffer.push(Buffer.from("ab"));
    buffer.push(Buffer.from("cd"));
    buffer.push(Buffer.from("e"));
    expect(buffer.all().join("")).toBe("cde");
    buffer.push(Buffer.from("too long"));
    expect(buffer.all().join("")).toBe("too long");
  });
});

describe("joinLiveConsole", () => {
  it("keeps the program when the connection closes, and shows what was missed to the next one", async () => {
    const program = fakeTerminal();
    const start = info();
    const first = await join(start, async () => program.terminal);
    program.say("before ");
    first.close(1001);
    expect(program.stop).not.toHaveBeenCalled();
    expect(liveConsole(start.id)?.attached).toBe(false);

    program.say("while away");
    const open = vi.fn(async () => fakeTerminal().terminal);
    const second = await join(start, open);
    expect(open).not.toHaveBeenCalled();
    expect(second.bytes()).toBe("before while away");
    expect(second.messages()).toEqual(["replay-start", "replay-end"]);

    second.emit("message", Buffer.from("typed"), true);
    expect(program.typed).toEqual(["typed"]);
    program.say(" and after");
    expect(second.bytes()).toContain(" and after");
  });

  it("gives it to the last page that connects, and tells the one before", async () => {
    const program = fakeTerminal();
    const start = info();
    const first = await join(start, async () => program.terminal);
    const second = await join(start, async () => program.terminal);
    expect(first.messages()).toContain("replaced");
    expect(first.closedWith).toBe(REPLACED_CLOSE_CODE);
    expect(liveConsole(start.id)?.attached).toBe(true);

    first.emit("message", Buffer.from("too late"), true);
    expect(program.typed).toEqual([]);
    second.emit("message", Buffer.from("here"), true);
    expect(program.typed).toEqual(["here"]);
  });

  it("applies a size sent before the program was ready", async () => {
    const program = fakeTerminal();
    const socket = new FakeSocket();
    joinLiveConsole(socket as unknown as WebSocket, info(), async () => program.terminal);
    socket.emit("message", Buffer.from(JSON.stringify({ type: "resize", cols: 100, rows: 30 })), false);
    await settle();
    expect(program.sizes).toEqual([[100, 30]]);
  });

  it("stops it when asked", async () => {
    const program = fakeTerminal();
    const start = info();
    const socket = await join(start, async () => program.terminal);
    stopLiveConsole(start.id);
    expect(program.stop).toHaveBeenCalledOnce();
    expect(socket.closedWith).toBe(1000);
    expect(liveConsole(start.id)).toBeNull();
  });

  it("forgets a program that ends by itself, connected or not", async () => {
    const program = fakeTerminal();
    const start = info();
    const socket = await join(start, async () => program.terminal);
    program.exit(7);
    expect(socket.messages()).toContain("exit");
    expect(socket.closedWith).toBe(1000);
    expect(liveConsole(start.id)).toBeNull();

    const other = fakeTerminal();
    const next = info();
    (await join(next, async () => other.terminal)).close(1001);
    other.exit(0);
    expect(liveConsole(next.id)).toBeNull();
  });

  it("stops a program nobody came back for", async () => {
    const program = fakeTerminal();
    const start = info();
    const socket = await join(start, async () => program.terminal, 1000);
    vi.useFakeTimers();
    socket.close(1001);
    vi.advanceTimersByTime(999);
    expect(program.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(program.stop).toHaveBeenCalledOnce();
  });

  it("does not stop a program someone came back to", async () => {
    const program = fakeTerminal();
    const start = info();
    const socket = await join(start, async () => program.terminal, 1000);
    socket.close(1001);
    await join(start, async () => program.terminal, 1000);
    vi.useFakeTimers();
    vi.advanceTimersByTime(5000);
    expect(program.stop).not.toHaveBeenCalled();
  });

  it("tells why it could not be started, and lets the next one try", async () => {
    const start = info();
    const socket = await join(start, async () => {
      throw new Error("no such program");
    });
    expect(socket.closedWith).toBe(1011);
    expect(socket.messages()).toEqual(["error"]);
    expect(liveConsole(start.id)).toBeNull();
    expect((await join(start, async () => fakeTerminal().terminal)).closedWith).toBeNull();
  });

  it("keeps a program started for a connection that left meanwhile, for a limited time", async () => {
    const program = fakeTerminal();
    const start = info();
    let release: (terminal: Terminal) => void = () => undefined;
    const socket = new FakeSocket();
    joinLiveConsole(socket as unknown as WebSocket, start, () => new Promise((resolve) => (release = resolve)), 1000);
    socket.close(1001);
    release(program.terminal);
    await settle();
    expect(liveConsole(start.id)?.attached).toBe(false);
    stopLiveConsole(start.id);
    expect(program.stop).toHaveBeenCalledOnce();
  });
});
