import http from "node:http";
import { type WebSocket, WebSocketServer } from "ws";
import { openDockerTerminal } from "./docker-terminal";
import { authorizeUpgrade, type Grant } from "./grants";
import { joinLiveConsole } from "./live-consoles";
import { startSession } from "./session";
import type { Terminal } from "./terminal";

const MAX_SESSIONS = 8;
const PING_MS = 30_000;

type ConsoleServer = { port: number };

async function openClaude(grant: Extract<Grant, { kind: "claude" }>): Promise<Terminal> {
  // Loaded when needed: a native module that failed to build must not take Docker consoles with it.
  const { openClaudeTerminal } = await import("./claude-terminal");
  return openClaudeTerminal(grant);
}

async function openRemote(grant: Extract<Grant, { kind: "remote" }>): Promise<Terminal> {
  const { openRemoteTerminal } = await import("./remote-terminal");
  return openRemoteTerminal(grant.command, grant.notes);
}

/** A shell ends with its connection. Claude may be in the middle of something, so it goes on. */
function serve(ws: WebSocket, grant: Grant): void {
  if (grant.kind === "docker") {
    startSession(ws, () => openDockerTerminal(grant.containerId, grant.options));
    return;
  }
  if (grant.kind === "remote") {
    startSession(ws, () => openRemote(grant));
    return;
  }
  const { consoleId: id, projectId, projectName, sessionId, startedAt } = grant;
  joinLiveConsole(ws, { id, projectId, projectName, sessionId, startedAt }, () => openClaude(grant));
}

// Kept on globalThis so that a hot reload in dev does not open a second server.
const holder = globalThis as unknown as { __pmConsoleServer?: Promise<ConsoleServer>; __pmConsoleServerVersion?: number };

/**
 * To raise when `serve` learns a new kind of grant. A server started before a hot reload keeps
 * its old code and would misread the grant: a new one takes over, and the old one finishes what it holds.
 */
const SERVER_VERSION = 2;

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
      serve(ws, grant);
    });
  });

  // A tab closed without a goodbye must not leave a shell running, or a console taken.
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
    // Loopback only: this port opens a shell in a container, and Claude on this machine.
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as { port: number }).port;
  server.unref();
  return { port };
}

export async function ensureConsoleServer(): Promise<number> {
  if (holder.__pmConsoleServerVersion !== SERVER_VERSION) {
    holder.__pmConsoleServer = undefined;
    holder.__pmConsoleServerVersion = SERVER_VERSION;
  }
  holder.__pmConsoleServer ??= start().catch((error) => {
    holder.__pmConsoleServer = undefined;
    throw error;
  });
  return (await holder.__pmConsoleServer).port;
}
