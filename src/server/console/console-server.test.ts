import http from "node:http";
import type { Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONSOLE_OPTIONS } from "@/lib/console-options";
import { issueGrant } from "./grants";
import { ensureConsoleServer } from "./server";

let dir: string;
let daemon: http.Server;
let port: number;
const created: { id: string; container: string; body: Record<string, unknown> }[] = [];
const resized: string[] = [];
const detached: string[] = [];
const streams: Socket[] = [];
const running = new Set<string>();
let execCount = 0;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pm-console-"));
  const socketPath = join(dir, "docker.sock");
  process.env.DOCKER_HOST = `unix://${socketPath}`;

  daemon = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const reply = (status: number, body: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const url = req.url ?? "";
      const exec = /^\/containers\/([^/]+)\/exec$/.exec(url);
      if (req.method === "POST" && exec) {
        if (exec[1] === "missing") return reply(404, { message: "No such container: missing" });
        execCount += 1;
        const id = `e${execCount}`;
        created.push({ id, container: exec[1], body: JSON.parse(Buffer.concat(chunks).toString()) });
        return reply(201, { Id: id });
      }
      const resize = /^\/exec\/(e\d+)\/resize/.exec(url);
      if (req.method === "POST" && resize) {
        resized.push(new URL(url, "http://x").searchParams.toString());
        return reply(200, {});
      }
      const detach = /^\/exec\/(e\d+)\/start$/.exec(url);
      if (req.method === "POST" && detach) {
        detached.push(detach[1]);
        return reply(200, {});
      }
      const inspect = /^\/exec\/(e\d+)\/json$/.exec(url);
      if (inspect) return reply(200, { Running: running.has(inspect[1]), ExitCode: 3 });
      reply(404, { message: "not found" });
    });
  });
  // The terminal stream: what is typed comes back in capitals, and `exit` ends the shell.
  daemon.on("upgrade", (req, socket: Socket) => {
    const id = /^\/exec\/(e\d+)\/start$/.exec(req.url ?? "")?.[1] ?? "";
    running.add(id);
    socket.on("close", () => running.delete(id));
    streams.push(socket);
    socket.write(
      "HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.raw-stream\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n",
    );
    socket.write("$ ");
    // As a terminal does when the program holding it is hung up on.
    socket.on("end", () => socket.end());
    socket.on("data", (data) => {
      if (data.toString().startsWith("exit")) socket.end();
      else if (data.toString().startsWith("{")) return;
      else socket.write(data.toString().toUpperCase());
    });
  });
  await new Promise<void>((resolve) => daemon.listen(socketPath, resolve));
  port = await ensureConsoleServer();
});

afterAll(() => {
  daemon.close();
  rmSync(dir, { recursive: true, force: true });
});

const grant = (containerId = "c1") =>
  issueGrant({ containerId, options: DEFAULT_CONSOLE_OPTIONS, appHost: "127.0.0.1:4300" });

const connect = (token: string, headers: Record<string, string> = { Origin: "http://127.0.0.1:4300" }) =>
  new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`, { headers });

type Frame = { binary: boolean; text: string };
function collect(ws: WebSocket) {
  const frames: Frame[] = [];
  ws.on("message", (data, isBinary) => frames.push({ binary: isBinary, text: data.toString() }));
  const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
  const until = async (check: (frames: Frame[]) => boolean) => {
    for (let attempt = 0; attempt < 100 && !check(frames); attempt += 1) await new Promise((r) => setTimeout(r, 20));
    expect(check(frames)).toBe(true);
  };
  return { frames, closed, until };
}

const status = (ws: WebSocket) =>
  new Promise<number>((resolve) => {
    ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
    ws.on("error", () => undefined);
  });

describe("console server", () => {
  it("opens a terminal in the container, carries what is typed both ways, and reports the exit", async () => {
    const ws = connect(grant());
    const { frames, closed, until } = collect(ws);
    await new Promise((resolve) => ws.on("open", resolve));
    ws.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
    ws.send(Buffer.from("ls"), { binary: true });

    await until((all) => all.some(({ binary, text }) => binary && text.includes("LS")));
    expect(frames[0]).toEqual({ binary: true, text: "$ " });

    expect(created.at(-1)).toMatchObject({
      container: "c1",
      body: { Tty: true, AttachStdin: true },
    });
    expect(created.at(-1)?.body.Env).toEqual([
      "TERM=xterm-256color",
      "COLORTERM=truecolor",
      expect.stringMatching(/^PM_CONSOLE_SESSION=[0-9a-f]{24}$/),
    ]);
    expect(created.at(-1)?.body.Cmd).toEqual(["sh", "-c", expect.stringContaining("exec bash")]);
    expect(resized.at(-1)).toBe("h=30&w=100");

    ws.send(Buffer.from("exit"), { binary: true });
    expect(await closed).toBe(1000);
    expect(frames.at(-1)).toEqual({ binary: false, text: JSON.stringify({ type: "exit", code: 3 }) });
    // The program ended by itself: there is nothing left to stop.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(detached).toEqual([]);
  });

  it("applies a size sent before the shell was ready, once it is", async () => {
    const ws = connect(grant());
    ws.on("open", () => ws.send(JSON.stringify({ type: "resize", cols: 7, rows: 9 })));
    const { until } = collect(ws);
    await until(() => resized.includes("h=9&w=7"));
    ws.close();
  });

  it("keeps the size within what a terminal can be", async () => {
    const ws = connect(grant());
    await new Promise((resolve) => ws.on("open", resolve));
    ws.send(JSON.stringify({ type: "resize", cols: 99999, rows: -4 }));
    const { until } = collect(ws);
    await until(() => resized.includes("h=1&w=500"));
    ws.close();
  });

  it("ends the shell when the browser goes away", async () => {
    const before = streams.length;
    const ws = connect(grant());
    const { until } = collect(ws);
    await new Promise((resolve) => ws.on("open", resolve));
    await until(() => streams.length > before);
    const stream = streams[before];
    ws.close();
    await new Promise<void>((resolve) => stream.on("close", () => resolve()));
    expect(stream.destroyed).toBe(true);
  });

  it("stops the program that was left running, from inside the container, by its marker", async () => {
    const before = created.length;
    const ws = connect(grant());
    const { until } = collect(ws);
    await new Promise((resolve) => ws.on("open", resolve));
    const markerOf = (body: Record<string, unknown>) =>
      (body.Env as string[] | undefined)?.find((value) => value.startsWith("PM_CONSOLE_SESSION="));
    await until(() => created.slice(before).some(({ body }) => markerOf(body)));
    const marker = markerOf(created.slice(before).find(({ body }) => markerOf(body))?.body ?? {}) ?? "";
    expect(marker).toMatch(/^PM_CONSOLE_SESSION=[0-9a-f]{24}$/);

    ws.close();
    const cleanupFor = () => created.find(({ body }) => (body.Cmd as string[] | undefined)?.[4] === marker);
    for (let attempt = 0; attempt < 100 && !(cleanupFor() && detached.includes(cleanupFor()?.id ?? "")); attempt += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const cleanup = cleanupFor();
    expect(cleanup).toBeDefined();
    expect(detached).toContain(cleanup?.id);
    expect(cleanup?.body).toMatchObject({ User: "0", Tty: false, AttachStdin: false });
    const script = String((cleanup?.body.Cmd as string[])[2]);
    expect(script).toContain("kill -HUP");
    expect(script).toContain("kill -KILL");
    expect(cleanup?.body.Env).toBeUndefined();
  });

  it("tells the browser why a shell could not be opened", async () => {
    const ws = connect(grant("missing"));
    const { frames, closed } = collect(ws);
    expect(await closed).toBe(1011);
    expect(JSON.parse(frames[0].text)).toEqual({ type: "error", message: "No such container: missing" });
  });

  it("refuses another site, a token that was already used, and a host that was rebound", async () => {
    expect(await status(connect(grant(), { Origin: "http://evil.test" }))).toBe(403);
    const token = grant();
    const first = connect(token);
    await new Promise((resolve) => first.on("open", resolve));
    expect(await status(connect(token))).toBe(403);
    first.close();
    expect(await status(connect(grant(), { Origin: "http://127.0.0.1:4300", Host: `evil.test:${port}` }))).toBe(403);
    expect(await status(connect("not-a-token"))).toBe(403);
  });

  it("answers nothing on plain HTTP", async () => {
    const status404 = await new Promise<number>((resolve) =>
      http.get({ host: "127.0.0.1", port }, (res) => resolve(res.statusCode ?? 0)),
    );
    expect(status404).toBe(404);
  });
});
