import http from "node:http";
import type { Duplex } from "node:stream";
import type { ExecSpec } from "@/lib/console-options";

type Reply = { status: number; body: string };

function request(socketPath: string, method: string, path: string, body?: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        socketPath,
        method,
        path,
        timeout: 15_000,
        headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("Docker did not answer in time")));
    req.on("error", reject);
    req.end(payload);
  });
}

function failure(reply: Reply): Error {
  try {
    const { message } = JSON.parse(reply.body) as { message?: string };
    if (message) return new Error(message);
  } catch {
    // Not JSON: the raw text is all there is.
  }
  return new Error(reply.body.trim() || `Docker answered ${reply.status}`);
}

/** The container is named by id, which comes from Docker's own list and never from the browser. */
export async function createExec(socketPath: string, containerId: string, spec: ExecSpec): Promise<string> {
  const reply = await request(socketPath, "POST", `/containers/${encodeURIComponent(containerId)}/exec`, {
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Cmd: spec.cmd,
    Env: spec.env,
    ...(spec.user ? { User: spec.user } : {}),
    ...(spec.workingDir ? { WorkingDir: spec.workingDir } : {}),
  });
  if (reply.status !== 201) throw failure(reply);
  return (JSON.parse(reply.body) as { Id: string }).Id;
}

/** With a terminal, what comes back is the raw stream of the program, with no framing. */
export function startExec(socketPath: string, execId: string): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ Detach: false, Tty: true });
    const req = http.request({
      socketPath,
      method: "POST",
      path: `/exec/${encodeURIComponent(execId)}/start`,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        Connection: "Upgrade",
        Upgrade: "tcp",
      },
    });
    req.on("upgrade", (_res, socket, head) => {
      // What the program already printed can arrive with the headers.
      if (head.length > 0) socket.unshift(head);
      resolve(socket);
    });
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => reject(failure({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() })));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

/**
 * Docker leaves a program running when the browser that held its terminal goes away,
 * and has no call to stop it. This finds it from inside the container, by the variable
 * that marks the session, and asks it to hang up before insisting.
 */
const END_SESSION = `
find() { for p in /proc/[0-9]*; do tr '\\0' '\\n' < "$p/environ" 2>/dev/null | grep -qx "$1" && echo "\${p#/proc/}"; done; }
pids=$(find "$1")
[ -n "$pids" ] && kill -HUP $pids
sleep 2
pids=$(find "$1")
[ -n "$pids" ] && kill -KILL $pids
exit 0
`;

export async function endSession(socketPath: string, containerId: string, marker: string): Promise<void> {
  const created = await request(socketPath, "POST", `/containers/${encodeURIComponent(containerId)}/exec`, {
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    Tty: false,
    // Root, to see and signal the processes of any user.
    User: "0",
    Cmd: ["sh", "-c", END_SESSION, "sh", marker],
  });
  if (created.status !== 201) throw failure(created);
  const { Id } = JSON.parse(created.body) as { Id: string };
  const started = await request(socketPath, "POST", `/exec/${encodeURIComponent(Id)}/start`, { Detach: true, Tty: false });
  if (started.status >= 300) throw failure(started);
}

export async function resizeExec(socketPath: string, execId: string, cols: number, rows: number): Promise<void> {
  const reply = await request(socketPath, "POST", `/exec/${encodeURIComponent(execId)}/resize?h=${rows}&w=${cols}`);
  if (reply.status >= 300) throw failure(reply);
}

export async function inspectExec(
  socketPath: string,
  execId: string,
): Promise<{ running: boolean; exitCode: number | null }> {
  const reply = await request(socketPath, "GET", `/exec/${encodeURIComponent(execId)}/json`);
  if (reply.status !== 200) throw failure(reply);
  const { Running, ExitCode } = JSON.parse(reply.body) as { Running?: boolean; ExitCode?: number | null };
  return { running: Running === true, exitCode: ExitCode ?? null };
}
