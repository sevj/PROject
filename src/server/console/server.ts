import http from "node:http";
import { type WebSocket, WebSocketServer } from "ws";
import { authorizeUpgrade } from "./grants";
import { startSession } from "./session";

const MAX_SESSIONS = 8;
const PING_MS = 30_000;

type ConsoleServer = { port: number };

// Kept on globalThis so that a hot reload in dev does not open a second server.
const holder = globalThis as unknown as { __pmConsoleServer?: Promise<ConsoleServer> };

async function start(): Promise<ConsoleServer> {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  const alive = new WeakSet<WebSocket>();
  let port = 0;

  const server = http.createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });

  server.on("upgrade", (req, socket, head) => {
    const grant = authorizeUpgrade({ host: req.headers.host, origin: req.headers.origin }, req.url, port);
    const refuse = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!grant) return refuse("403 Forbidden");
    if (wss.clients.size >= MAX_SESSIONS) return refuse("503 Service Unavailable");
    wss.handleUpgrade(req, socket, head, (ws) => {
      alive.add(ws);
      ws.on("pong", () => alive.add(ws));
      startSession(ws, grant);
    });
  });

  // A tab closed without a goodbye must not leave a shell running.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, PING_MS);
  heartbeat.unref();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Loopback only: this port opens a shell in a container.
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as { port: number }).port;
  server.unref();
  return { port };
}

export async function ensureConsoleServer(): Promise<number> {
  holder.__pmConsoleServer ??= start().catch((error) => {
    holder.__pmConsoleServer = undefined;
    throw error;
  });
  return (await holder.__pmConsoleServer).port;
}
