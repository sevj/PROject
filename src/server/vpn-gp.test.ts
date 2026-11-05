import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "./db/client";
import { vpns } from "./db/schema";
import type { CommandRunner, Ran } from "./run-command";
import { gpScript } from "@/lib/vpn";
import { connectVpn, deleteVpn, disconnectVpn, listVpns, readActiveVpns, saveVpn, type VpnInput } from "./vpn";
import type { GpDriver } from "./vpn-gp";
import type { SudoDriver } from "./vpn-sudo";

let dir: string;
let db: Db;
const input: VpnInput = { name: "Corp GP", kind: "globalprotect", configPath: null, username: null, password: "", tokenAppended: false, gateway: "vpn.corp.fr" };
const RULE = '(root) NOPASSWD: /usr/local/sbin/pm-gp-corp-gp ""\n';
const SAML = "HOST=https://vpn.corp.fr/gateway:prelogin-cookie\nUSER='CORP\\jd'\nCOOKIE=c00kie\nOS=linux-64\n";
/** sudo lists the rule, and gp-saml-gui answers as after a login. */
function machine(answers: { rule?: string; saml?: Partial<Ran> } = {}) {
  return vi.fn<CommandRunner>(async (command) => {
    if (command === "sudo") return { code: 0, stdout: answers.rule ?? RULE, stderr: "", notInstalled: false };
    if (command === "gp-saml-gui") return { code: 0, stdout: SAML, stderr: "", notInstalled: false, ...answers.saml };
    return { code: 0, stdout: "", stderr: "", notInstalled: false };
  });
}
const run = vi.fn<CommandRunner>(async () => ({ code: 0, stdout: "", stderr: "", notInstalled: false }));
const sudo: SudoDriver = { uid: 1000, user: "me", launch: async () => undefined, state: async () => "off", stop: async () => false, readLog: async () => "" };
const idOf = (saved: { id: number } | { problem: string }) => {
  if ("problem" in saved) throw new Error(saved.problem);
  return saved.id;
};

/** Each read of the log gives the next one; it stays alive until it is stopped, or `dies` says otherwise. */
function fakeGp(logs: string[], options: { running?: boolean; dies?: boolean; script?: string; ended?: boolean } = {}) {
  let running = options.running ?? false;
  const driver: GpDriver & { launched: { command: string[]; secret: string; slug: string }[]; stopped: string[] } = {
    launched: [],
    stopped: [],
    launch: async (command, secret, slug) => {
      driver.launched.push({ command, secret, slug });
      running = !options.dies;
    },
    alive: async () => running,
    ended: async () => !running && (options.ended ?? false),
    stop: async (slug) => {
      driver.stopped.push(slug);
      const was = running;
      running = false;
      return was;
    },
    readLog: async () => (logs.length > 1 ? (logs.shift() ?? "") : (logs[0] ?? "")),
    readScript: async () => options.script ?? "",
  };
  return driver;
}
const connect = (id: number, gp: GpDriver, runner: CommandRunner = machine()) => {
  const clock = { at: 0 };
  return connectVpn(db, id, {}, runner, () => (clock.at += 1000), async () => undefined, sudo, gp);
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-vpn-gp-"));
  process.env.PM_SECRET_KEY_PATH = join(dir, "secret.key");
});
afterAll(() => {
  delete process.env.PM_SECRET_KEY_PATH;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  db = openDb(":memory:");
  run.mockClear();
});
const saved = () => saveVpn(db, null, input, run, dir).then(idOf);

describe("saving", () => {
  it("keeps only the portal: the login happens at Microsoft", async () => {
    const id = await saveVpn(db, null, { ...input, username: "x", password: "secret" }, run, dir).then(idOf);
    expect(run).not.toHaveBeenCalled();
    const row = db.select().from(vpns).where(eq(vpns.id, id)).get();
    expect(row).toMatchObject({ kind: "globalprotect", gateway: "vpn.corp.fr", username: null, passwordSecret: null, sudoSlug: "corp-gp" });
  });

  it("wants the name of a portal", async () => {
    expect(await saveVpn(db, null, { ...input, gateway: "https://vpn.corp.fr" }, run, dir)).toMatchObject({ problem: "portalInvalid" });
    expect(await saveVpn(db, null, { ...input, gateway: "--help" }, run, dir)).toMatchObject({ problem: "portalInvalid" });
  });
});

describe("listing", () => {
  it("is ready only with the rule and the script written for this portal", async () => {
    const id = await saved();
    const gp = (script: string) => fakeGp(["Configured as 10.0.0.2, with SSL connected\n"], { running: true, script });
    const [view] = await listVpns(db, machine(), sudo, gp(gpScript("corp-gp", "vpn.corp.fr")));
    expect(view).toMatchObject({ state: "connected", setup: { ready: true, removal: "sudo rm /etc/sudoers.d/pm-vpn-corp-gp /usr/local/sbin/pm-gp-corp-gp" } });
    expect(view.setup?.commands[0]).toContain("--passwd-on-stdin vpn.corp.fr");
    await saveVpn(db, id, { ...input, gateway: "gp.corp.fr" }, run, dir);
    const [moved] = await listVpns(db, machine(), sudo, gp(gpScript("corp-gp", "vpn.corp.fr")));
    expect(moved.setup?.ready).toBe(false);
    const [noRule] = await listVpns(db, machine({ rule: "" }), sudo, gp(gpScript("corp-gp", "gp.corp.fr")));
    expect(noRule.setup?.ready).toBe(false);
  });

  it("reads the state from the log", async () => {
    await saved();
    expect(await readActiveVpns(db, run, sudo, fakeGp(["POST …\n"], { running: true }))).toMatchObject([{ state: "connecting" }]);
    expect(await readActiveVpns(db, run, sudo, fakeGp(["Configured as 10.0.0.2\n"]))).toEqual([]);
  });

  it("says the session ended when it was up and stopped by itself, not after a failed attempt", async () => {
    await saved();
    const state = async (log: string, ended: boolean) => (await listVpns(db, machine(), sudo, fakeGp([log], { ended })))[0].state;
    expect(await state("Configured as 10.0.0.2\nSession terminated by server; exiting.\n", true)).toBe("lost");
    expect(await state("Configured as 10.0.0.2\nFailed to reconnect to host vpn.corp.fr\n", true)).toBe("lost");
    expect(await state("Could not resolve host vpn.corp.fr\n", true)).toBe("off");
    expect(await state("Configured as 10.0.0.2\n", false)).toBe("off");
    expect(await readActiveVpns(db, run, sudo, fakeGp(["Configured as 10.0.0.2\n"], { ended: true }))).toEqual([]);
  });
});

describe("networks", () => {
  it("are kept tidy, and their change asks for the script again", async () => {
    const id = await saveVpn(db, null, { ...input, routes: "192.168.200.37/24" }, run, dir).then(idOf);
    expect(db.select().from(vpns).where(eq(vpns.id, id)).get()?.routes).toBe("192.168.200.0/24");
    expect(await saveVpn(db, id, { ...input, routes: "192.168.200.0/40" }, run, dir)).toMatchObject({ problem: "routesInvalid" });
    const script = gpScript("corp-gp", "vpn.corp.fr", [{ address: "192.168.200.0", mask: "255.255.255.0", length: 24 }]);
    const [view] = await listVpns(db, machine(), sudo, fakeGp([""], { script }));
    expect(view).toMatchObject({ routes: "192.168.200.0/24", setup: { ready: true } });
    await saveVpn(db, id, { ...input, routes: "" }, run, dir);
    const [all] = await listVpns(db, machine(), sudo, fakeGp([""], { script }));
    expect(all).toMatchObject({ routes: null, setup: { ready: false } });
  });
});

describe("connecting", () => {
  it("logs in at Microsoft, then gives the cookie to the root script", async () => {
    const id = await saved();
    const runner = machine();
    const gp = fakeGp(["", "POST …\n", "Configured as 10.0.0.2, with SSL connected\n"]);
    expect(await connect(id, gp, runner)).toEqual({ ok: true });
    expect(runner.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ["sudo", ["-n", "-l"]],
      ["gp-saml-gui", ["--gateway", "--clientos", "Linux", "vpn.corp.fr"]],
    ]);
    expect(gp.launched).toEqual([{ command: ["/usr/local/sbin/pm-gp-corp-gp"], secret: "CORP\\jd\ngateway:prelogin-cookie\nc00kie", slug: "corp-gp" }]);
    expect(db.select().from(vpns).where(eq(vpns.id, id)).get()?.username).toBe("CORP\\jd");
  });

  it("asks nothing of Microsoft while the rule is missing", async () => {
    const id = await saved();
    const runner = machine({ rule: "" });
    expect(await connect(id, fakeGp([""]), runner)).toMatchObject({ problem: "sudoRuleMissing" });
    expect(runner.mock.calls.map(([command]) => command)).toEqual(["sudo"]);
  });

  it("says when the login did not end, without the cookie", async () => {
    const id = await saved();
    const closed = machine({ saml: { code: 1, stdout: "", stderr: "[PAGE   ] Finished loading page https://login.microsoftonline.com/x\n" } });
    expect(await connect(id, fakeGp([""]), closed)).toMatchObject({ problem: "samlFailed", detail: "[PAGE   ] Finished loading page https://login.microsoftonline.com/x" });
    expect(await connect(id, fakeGp([""]), machine({ saml: { code: 127, notInstalled: true } }))).toMatchObject({ problem: "gpSamlMissing" });
    const leaked = machine({ saml: { code: 1, stdout: "", stderr: "    echo c00kie |\n        sudo openconnect --protocol=gp\n" } });
    expect(JSON.stringify(await connect(id, fakeGp([""]), leaked))).not.toContain("c00kie");
  });

  it("stops at the first refusal", async () => {
    const id = await saved();
    const gp = fakeGp(["", "Failed to complete authentication\n"]);
    expect(await connect(id, gp)).toMatchObject({ problem: "authRefused" });
    expect(gp.stopped).toEqual(["corp-gp"]);
  });

  it("says when openconnect ended by itself", async () => {
    const id = await saved();
    expect(await connect(id, fakeGp(["Could not resolve host vpn.corp.fr\n"], { dies: true }))).toMatchObject({ problem: "connectFailed", detail: "Could not resolve host vpn.corp.fr" });
  });

  it("does not log in again when it is already up", async () => {
    const id = await saved();
    const runner = machine();
    const gp = fakeGp(["Configured as 10.0.0.2\n"], { running: true });
    expect(await connect(id, gp, runner)).toEqual({ ok: true });
    expect(gp.launched).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });

  it("gives up after the wait, and stops it", async () => {
    const id = await saved();
    const gp = fakeGp(["POST …\n"]);
    expect(await connect(id, gp)).toMatchObject({ problem: "timeout" });
    expect(gp.stopped).toEqual(["corp-gp"]);
  });
});

describe("disconnecting and deleting", () => {
  it("stops it through sudo, without nmcli", async () => {
    const id = await saved();
    expect(await disconnectVpn(db, id, run, sudo, fakeGp([""], { running: true }))).toBeNull();
    expect(await disconnectVpn(db, id, run, sudo, fakeGp([""]))).toMatchObject({ problem: "disconnectFailed" });
    const gp = fakeGp([""], { running: true });
    expect(await deleteVpn(db, id, run, sudo, gp)).toBeNull();
    expect(gp.stopped).toEqual(["corp-gp"]);
    expect(run).not.toHaveBeenCalled();
    expect(db.select().from(vpns).all()).toEqual([]);
  });
});
