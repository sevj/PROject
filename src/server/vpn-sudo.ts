import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { parseManagementState, type VpnState } from "@/lib/vpn";

const SOCKET_TIMEOUT_MS = 2000;

/** What runs openvpn and talks to it, apart so that the rest can be tried without root. */
export type SudoDriver = {
  uid: number;
  user: string;
  launch(command: string[], secret: string, logFile: string): Promise<void>;
  state(socket: string): Promise<VpnState>;
  /** False when nothing answered. */
  stop(socket: string): Promise<boolean>;
  readLog(logFile: string): Promise<string>;
};

/** Its output holds no secret, but tells where and when: it stays private. */
export function sudoLogFile(slug: string): string {
  const state = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  const folder = join(state, "project-manager");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  return join(folder, `vpn-${slug}.log`);
}

/** Sends one command to the management socket, and resolves with what it answered up to `END`. */
function ask(socket: string, command: string, until: RegExp): Promise<string | null> {
  return new Promise((resolve) => {
    const connection = createConnection(socket);
    let answer = "";
    const finish = (value: string | null) => {
      connection.destroy();
      resolve(value);
    };
    connection.setTimeout(SOCKET_TIMEOUT_MS, () => finish(null));
    connection.once("error", () => finish(null));
    connection.once("connect", () => connection.write(`${command}\n`));
    connection.on("data", (chunk) => {
      answer += chunk.toString();
      if (until.test(answer)) finish(answer);
    });
  });
}

export const realSudoDriver: SudoDriver = {
  uid: process.getuid?.() ?? 0,
  user: userInfo().username,

  /**
   * `sudo -n` never asks: without the rule it says so and stops. Detached, so that restarting the
   * app does not cut the VPN. openvpn opens /dev/stdin by name, which a socket does not allow, so
   * `cat` turns the pipe of the secret into a real one.
   */
  async launch(command, secret, logFile) {
    const log = openSync(logFile, "w", 0o600);
    const child = spawn("sh", ["-c", 'cat <&3 | exec sudo -n "$@"', "sh", ...command], {
      detached: true,
      stdio: ["ignore", log, log, "pipe"],
      env: { ...process.env, LC_ALL: "C" },
    });
    closeSync(log);
    const pipe = child.stdio[3] as NodeJS.WritableStream;
    pipe.on("error", () => undefined);
    pipe.end(`${secret}\n`);
    child.once("error", () => undefined);
    child.unref();
  },

  async state(socket) {
    const answer = await ask(socket, "state", /^END\s*$/m);
    return answer === null ? "off" : parseManagementState(answer);
  },

  async stop(socket) {
    return (await ask(socket, "signal SIGTERM", /SUCCESS|ERROR/)) !== null;
  },

  readLog: (logFile) => readFile(logFile, "utf8").catch(() => ""),
};
