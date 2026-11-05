import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { gpScriptPath, isOwnSudo } from "@/lib/vpn";
import { sudoLogFile } from "./vpn-sudo";

/** What runs openconnect, through the root script, and watches it, apart so that the rest can be tried without root. */
export type GpDriver = {
  launch(command: string[], secret: string, slug: string): Promise<void>;
  /** Whether the sudo started for this VPN still runs. */
  alive(slug: string): Promise<boolean>;
  /** Started since the machine booted and gone without being told to stop. */
  ended(slug: string): Promise<boolean>;
  /** False when nothing ran, or it could not be told to stop. One that ended by itself is forgotten. */
  stop(slug: string): Promise<boolean>;
  readLog(slug: string): Promise<string>;
  /** The root script as it lies, to tell whether it is still the one to paste. Empty when missing. */
  readScript(slug: string): Promise<string>;
};

/** Beside the log, in a folder only this user can open. */
const pidFile = (slug: string) => sudoLogFile(slug).replace(/\.log$/, ".pid");

async function runningPid(slug: string): Promise<number | null> {
  const pid = Number((await readFile(pidFile(slug), "utf8").catch(() => "")).trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const cmdline = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
  return isOwnSudo(cmdline) ? pid : null;
}

/** When the machine booted, in ms: a pid file older than that is from before, its process cannot have run since. */
async function bootedAt(): Promise<number> {
  const uptime = Number((await readFile("/proc/uptime", "utf8").catch(() => "0")).split(" ")[0]);
  return Date.now() - uptime * 1000;
}

/** The pid file stays when sudo ends by itself: only `stop` removes it. */
async function endedOnItsOwn(slug: string): Promise<boolean> {
  const written = await stat(pidFile(slug)).catch(() => null);
  if (!written || written.mtimeMs < (await bootedAt())) return false;
  return (await runningPid(slug)) === null;
}

export const realGpDriver: GpDriver = {
  /**
   * `sudo -n` never asks: without the rule it says so and stops. sudo stays the parent of
   * openconnect, which runs as root: told to stop by this user, it passes the signal on, so no
   * second rule is needed to cut it. Detached, so that restarting the app does not cut the VPN.
   */
  async launch(command, secret, slug) {
    const log = openSync(sudoLogFile(slug), "w", 0o600);
    const child = spawn("sudo", ["-n", ...command], {
      detached: true,
      stdio: ["pipe", log, log],
      env: { ...process.env, LC_ALL: "C" },
    });
    closeSync(log);
    child.once("error", () => undefined);
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(`${secret}\n`);
    if (child.pid) await writeFile(pidFile(slug), String(child.pid), { mode: 0o600 });
    child.unref();
  },

  alive: async (slug) => (await runningPid(slug)) !== null,

  /** SIGTERM: openconnect logs off from the portal before leaving. */
  ended: endedOnItsOwn,

  async stop(slug) {
    const pid = await runningPid(slug);
    if (pid === null) {
      if (!(await endedOnItsOwn(slug))) return false;
      await rm(pidFile(slug), { force: true });
      return true;
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return false;
    }
    await rm(pidFile(slug), { force: true });
    return true;
  },

  readLog: (slug) => readFile(sudoLogFile(slug), "utf8").catch(() => ""),

  readScript: (slug) => readFile(gpScriptPath(slug), "utf8").catch(() => ""),
};
