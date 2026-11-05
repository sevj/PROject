import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "./db/client";
import { vpns } from "./db/schema";
import type { CommandRunner } from "./run-command";
import { connectVpn, deleteVpn, disconnectVpn, listVpns, readActiveVpns, readVpnStatuses, saveVpn, type VpnInput } from "./vpn";
import { realSudoDriver, type SudoDriver } from "./vpn-sudo";

let dir: string;
let db: Db;
const input: VpnInput = { name: "La Villette", kind: "sudo_openvpn", configPath: "~/v.ovpn", username: "me", password: "pa\\ss,", tokenAppended: true, gateway: null };
const noRun = vi.fn<CommandRunner>(async () => ({ code: 0, stdout: "", stderr: "", notInstalled: false }));
const idOf = (saved: { id: number } | { problem: string }) => {
  if ("problem" in saved) throw new Error(saved.problem);
  return saved.id;
};

function fakeDriver(states: ("off" | "connecting" | "connected")[], log = "") {
  const driver: SudoDriver & { launched: { command: string[]; secret: string }[]; stopped: string[] } = {
    uid: 1000,
    user: "me",
    launched: [],
    stopped: [],
    launch: async (command, secret) => void driver.launched.push({ command, secret }),
    state: async () => states.shift() ?? "off",
    stop: async (socket) => {
      driver.stopped.push(socket);
      return true;
    },
    readLog: async () => log,
  };
  return driver;
}
const connect = (id: number, driver: SudoDriver, token = "654321", clock = { at: 0 }) =>
  connectVpn(db, id, { token }, noRun, () => (clock.at += 1000), async () => undefined, driver);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-vpn-sudo-"));
  process.env.PM_SECRET_KEY_PATH = join(dir, "secret.key");
  process.env.XDG_STATE_HOME = join(dir, "state");
  writeFileSync(join(dir, "v.ovpn"), "client\n");
});
afterAll(() => {
  delete process.env.PM_SECRET_KEY_PATH;
  delete process.env.XDG_STATE_HOME;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  db = openDb(":memory:");
});
const saved = () => saveVpn(db, null, input, noRun, dir).then(idOf);

describe("saving", () => {
  it("touches nothing outside the app, and keeps the password encrypted", async () => {
    noRun.mockClear();
    const id = await saved();
    expect(noRun).not.toHaveBeenCalled();
    const row = db.select().from(vpns).where(eq(vpns.id, id)).get();
    expect(row).toMatchObject({ sudoSlug: "la-villette", configPath: "~/v.ovpn", connectionUuid: null });
    expect(row?.passwordSecret).not.toContain("pa\\ss");
  });

  it("wants a user and a file that exists", async () => {
    expect(await saveVpn(db, null, { ...input, username: "" }, noRun, dir)).toMatchObject({ problem: "usernameInvalid" });
    expect(await saveVpn(db, null, { ...input, configPath: "~/absent.ovpn" }, noRun, dir)).toMatchObject({ problem: "fileMissing" });
  });

  it("keeps its file names when renamed, since the rule holds them", async () => {
    const id = await saved();
    await saveVpn(db, id, { ...input, name: "Autre", password: "" }, noRun, dir);
    const [view] = await listVpns(db, noRun, fakeDriver(["off"]));
    expect(view.name).toBe("Autre");
    expect(view.setup?.commands.join(" ")).toContain("pm-la-villette.conf");
  });
});

describe("listing", () => {
  it("shows what to paste, whether the rule is there, and nothing secret", async () => {
    await saved();
    const missing = vi.fn<CommandRunner>(async () => ({ code: 1, stdout: "", stderr: "sudo: a password is required", notInstalled: false }));
    const [view] = await listVpns(db, missing, fakeDriver(["off"]));
    expect(view.setup?.ready).toBe(false);
    expect(view.setup?.commands[1]).toContain("NOPASSWD: /usr/sbin/openvpn --config /etc/openvpn/client/pm-la-villette.conf");
    expect(missing.mock.calls[0][1]).toEqual(["-n", "-l"]);
    expect(JSON.stringify(view)).not.toContain("pa\\\\ss");
    const listed = vi.fn<CommandRunner>(async () => ({
      code: 0,
      stderr: "",
      notInstalled: false,
      stdout: "(root) NOPASSWD: /usr/sbin/openvpn --config /etc/openvpn/client/pm-la-villette.conf --auth-user-pass /dev/stdin --management /run/user/1000/pm-vpn-la-villette.sock unix\n",
    }));
    const [ready] = await listVpns(db, listed, fakeDriver(["connected"]));
    expect(ready).toMatchObject({ state: "connected", setup: { ready: true } });
  });
});

describe("readActiveVpns", () => {
  it("names only what is up, and asks nothing else", async () => {
    const run = vi.fn<CommandRunner>(async () => ({ code: 0, stdout: "", stderr: "", notInstalled: false }));
    expect(await readActiveVpns(db, run, fakeDriver([]))).toEqual([]);
    const id = await saved();
    expect(await readActiveVpns(db, run, fakeDriver(["off"]))).toEqual([]);
    expect(await readActiveVpns(db, run, fakeDriver(["connected"]))).toEqual([{ id, name: "La Villette", state: "connected" }]);
    expect(await readActiveVpns(db, run, fakeDriver(["connecting"]))).toEqual([{ id, name: "La Villette", state: "connecting" }]);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("readVpnStatuses", () => {
  it("lists every VPN with what connecting needs, without reading the sudo rules or the secret", async () => {
    const run = vi.fn<CommandRunner>(async () => ({ code: 0, stdout: "", stderr: "", notInstalled: false }));
    const id = await saved();
    const [status] = await readVpnStatuses(db, run, fakeDriver(["off"]));
    expect(status).toEqual({ id, name: "La Villette", kind: "sudo_openvpn", state: "off", hasPassword: expect.any(Boolean), tokenAppended: expect.any(Boolean), loggedIn: null });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("connecting", () => {
  it("runs the exact command of the rule, with the user and password+token on the pipe, as typed", async () => {
    const id = await saved();
    const driver = fakeDriver(["off", "connecting", "connected"]);
    expect(await connect(id, driver)).toEqual({ ok: true });
    expect(driver.launched).toHaveLength(1);
    expect(driver.launched[0].secret).toBe("me\npa\\ss,654321");
    expect(driver.launched[0].command).toEqual(["/usr/sbin/openvpn", "--config", "/etc/openvpn/client/pm-la-villette.conf", "--auth-user-pass", "/dev/stdin", "--management", "/run/user/1000/pm-vpn-la-villette.sock", "unix"]);
    expect(driver.launched[0].command.join(" ")).not.toContain("654321");
    expect(JSON.stringify(db.select().from(vpns).all())).not.toContain("654321");
  });

  it("does not start a second one", async () => {
    const id = await saved();
    const driver = fakeDriver(["connected"]);
    expect(await connect(id, driver)).toEqual({ ok: true });
    expect(driver.launched).toEqual([]);
  });

  it("asks for the token before anything runs", async () => {
    const id = await saved();
    const driver = fakeDriver(["off"]);
    expect(await connectVpn(db, id, {}, noRun, () => 0, async () => undefined, driver)).toMatchObject({ problem: "tokenNeeded" });
    expect(driver.launched).toEqual([]);
  });

  it("says each way it can end, and launches once", async () => {
    const id = await saved();
    for (const [log, problem] of [["AUTH: Received control message: AUTH_FAILED\n", "authRefused"], ["sudo: a password is required\n", "sudoRuleMissing"], ["Options error: bad\n", "connectFailed"]]) {
      const driver = fakeDriver(["off"], log);
      expect(await connect(id, driver)).toMatchObject({ problem });
      expect(driver.launched).toHaveLength(1);
    }
  });

  it("stops what never connects", async () => {
    const id = await saved();
    const driver = fakeDriver(Array(200).fill("connecting"));
    expect(driver.stopped).toEqual([]);
    expect(await connect(id, driver)).toMatchObject({ problem: "timeout" });
    expect(driver.stopped).toEqual(["/run/user/1000/pm-vpn-la-villette.sock"]);
  });

  it("disconnects through the socket, and when deleted", async () => {
    const id = await saved();
    const driver = fakeDriver([]);
    expect(await disconnectVpn(db, id, noRun, driver)).toBeNull();
    await deleteVpn(db, id, noRun, driver);
    expect(driver.stopped).toHaveLength(2);
    expect(db.select().from(vpns).all()).toEqual([]);
  });
});

describe("realSudoDriver", () => {
  let bin: string;
  let path: string | undefined;
  let server: Server | null = null;
  const socket = () => join(bin, "m.sock");

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "pm-sudo-bin-"));
    path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
  });
  afterAll(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
  });
  afterEach(() => {
    server?.close();
    server = null;
  });

  it("gives the secret through a real pipe that /dev/stdin can open, and keeps the output private", async () => {
    const got = join(bin, "got");
    writeFileSync(join(bin, "sudo"), `#!/bin/sh\necho "args: $*"\nsed -n p /dev/stdin > "${got}"\necho done\n`);
    chmodSync(join(bin, "sudo"), 0o755);
    const log = join(bin, "out.log");
    await realSudoDriver.launch(["/x", "--y"], "me\np\\a ss,1", log);
    for (let i = 0; i < 100 && !(await realSudoDriver.readLog(log)).includes("done"); i += 1) await new Promise((r) => setTimeout(r, 20));
    expect(readFileSync(got, "utf8")).toBe("me\np\\a ss,1\n");
    expect(await realSudoDriver.readLog(log)).toContain("args: -n /x --y");
    expect(statSync(log).mode & 0o777).toBe(0o600);
  });

  it("reads the state and stops through the socket, as OpenVPN answers", async () => {
    const received: string[] = [];
    server = createServer((connection) => {
      connection.write(">INFO:OpenVPN Management Interface\r\n");
      connection.on("data", (chunk) => {
        const line = chunk.toString().trim();
        received.push(line);
        connection.write(line === "state" ? "1793888000,CONNECTED,SUCCESS,10.0.0.2,1.2.3.4\r\nEND\r\n" : "SUCCESS: signal SIGTERM thrown\r\n");
      });
    });
    await new Promise<void>((resolve) => server?.listen(socket(), resolve));
    expect(await realSudoDriver.state(socket())).toBe("connected");
    expect(await realSudoDriver.stop(socket())).toBe(true);
    expect(received).toEqual(["state", "signal SIGTERM"]);
  });

  it("takes no socket for off, and says it could not stop", async () => {
    expect(await realSudoDriver.state(join(bin, "none.sock"))).toBe("off");
    expect(await realSudoDriver.stop(join(bin, "none.sock"))).toBe(false);
  });
});
