import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "./db/client";
import { remoteServers, vpns } from "./db/schema";
import { type CommandRunner, saveServer, testConnection } from "./remote-servers";
import { connectVpn, deleteVpn, disconnectVpn, listVpns, readOvpnSuggestions, saveVpn, type VpnInput } from "./vpn";

const UUID = "6f1b0c3e-1a2b-4c3d-8e4f-0123456789ab";
const input: VpnInput = { name: "Villette", kind: "openvpn", configPath: "~/v.ovpn", username: "me", password: "secret", tokenAppended: true, gateway: null };
const nord: VpnInput = { name: "Nord", kind: "nordlayer", configPath: null, username: null, password: "", tokenAppended: false, gateway: "fr-paris" };

const nmcli = (active = "") =>
  vi.fn<CommandRunner>(async (_command, args) => ({
    code: 0,
    stderr: "",
    notInstalled: false,
    stdout: args.includes("import") ? `Connection 'v' (${UUID}) successfully added.` : args.includes("--active") ? active : "",
  }));
const refusing = (stderr: string) => vi.fn<CommandRunner>(async () => ({ code: 4, stderr, stdout: "", notInstalled: false }));
const idOf = (saved: { id: number } | { problem: string }) => {
  if ("problem" in saved) throw new Error(saved.problem);
  return saved.id;
};

let db: Db;
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-vpn-"));
  process.env.PM_SECRET_KEY_PATH = join(dir, "secret.key");
  writeFileSync(join(dir, "v.ovpn"), "client\nroute remote_host 255.255.255.255 net_gateway\n");
  writeFileSync(join(dir, "other.txt"), "");
});
afterAll(() => {
  delete process.env.PM_SECRET_KEY_PATH;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  db = openDb(":memory:");
});

const saved = (run = nmcli()) => saveVpn(db, null, input, run, dir).then(idOf);

describe("saveVpn", () => {
  it("makes a profile that never connects alone nor keeps the password", async () => {
    const run = nmcli();
    const id = await saved(run);
    expect(run.mock.calls[0][1].slice(0, 3)).toEqual(["connection", "import", "type"]);
    expect(run.mock.calls[0][1].at(-1)).toMatch(/\/v\.ovpn$/);
    expect(run.mock.calls[1][1]).toEqual(expect.arrayContaining([UUID, "password-flags=2", "username=me"]));
    expect(run.mock.calls.flatMap(([, args]) => args).join(" ")).not.toContain("secret");
    const row = db.select().from(vpns).where(eq(vpns.id, id)).get();
    expect(row?.passwordSecret).not.toContain("secret");
    expect(row?.connectionUuid).toBe(UUID);
  });

  it("imports a private copy without the refused route, and leaves the user's file alone", async () => {
    let seen = { content: "", mode: 0, path: "" };
    const run = vi.fn<CommandRunner>(async (_command, args) => {
      if (args.includes("import")) {
        const path = args.at(-1) ?? "";
        seen = { content: readFileSync(path, "utf8"), mode: statSync(path).mode & 0o777, path };
      }
      return { code: 0, stderr: "", notInstalled: false, stdout: `Connection 'v' (${UUID}) successfully added.` };
    });
    await saved(run);
    expect(seen.content).not.toContain("route remote_host");
    expect(seen.mode).toBe(0o600);
    expect(existsSync(seen.path)).toBe(false);
    expect(readFileSync(join(dir, "v.ovpn"), "utf8")).toContain("route remote_host");
  });

  it("refuses what it cannot use", async () => {
    const run = nmcli();
    expect(await saveVpn(db, null, { ...input, name: " " }, run, dir)).toMatchObject({ problem: "nameMissing" });
    expect(await saveVpn(db, null, { ...input, configPath: "v.ovpn" }, run, dir)).toMatchObject({ problem: "fileInvalid" });
    expect(await saveVpn(db, null, { ...input, configPath: "~/absent.ovpn" }, run, dir)).toMatchObject({ problem: "fileMissing" });
    expect(await saveVpn(db, null, { ...input, username: "a,password-flags=0" }, run, dir)).toMatchObject({ problem: "usernameInvalid" });
    expect(await saveVpn(db, null, { ...input, password: "a\nb" }, run, dir)).toMatchObject({ problem: "passwordInvalid" });
    expect(await saveVpn(db, null, { ...nord, gateway: "--help" }, run, dir)).toMatchObject({ problem: "gatewayInvalid" });
    expect(run).not.toHaveBeenCalled();
  });

  it("says when NetworkManager refuses the file", async () => {
    expect(await saveVpn(db, null, input, refusing("Error: failed to import"), dir)).toMatchObject({ problem: "importFailed", detail: "Error: failed to import" });
  });

  it("leaves no profile behind if it cannot be set up", async () => {
    const run = vi.fn<CommandRunner>(async (_command, args) =>
      args.includes("modify") ? { code: 4, stderr: "no", stdout: "", notInstalled: false } : { code: 0, stderr: "", notInstalled: false, stdout: `Connection 'v' (${UUID}) successfully added.` },
    );
    expect(await saveVpn(db, null, input, run, dir)).toMatchObject({ problem: "importFailed" });
    expect(run.mock.calls.at(-1)?.[1]).toEqual(["connection", "delete", UUID]);
    expect(db.select().from(vpns).all()).toEqual([]);
  });

  it("changes without importing again, and keeps the password when left empty", async () => {
    const id = await saved();
    const before = db.select().from(vpns).where(eq(vpns.id, id)).get()?.passwordSecret;
    const run = nmcli();
    await saveVpn(db, id, { ...input, name: "Autre", password: "" }, run, dir);
    expect(run.mock.calls.flatMap(([, args]) => args)).not.toContain("import");
    expect(db.select().from(vpns).where(eq(vpns.id, id)).get()).toMatchObject({ name: "Autre", passwordSecret: before });
  });
});

describe("connectVpn", () => {
  const edited = () => vi.fn<CommandRunner>(async (command, args, secret) => ({
    code: 0,
    stderr: "",
    notInstalled: false,
    stdout: command === "sh" ? `nmcli> ${secret}\nConnection 'v' (${UUID}) successfully updated.` : args.includes("--active") ? "" : "",
  }));
  const failingUp = (stderr: string, code: number | null = 4) => vi.fn<CommandRunner>(async (command, _args, secret) =>
    command === "sh" ? { code: 0, stderr: "", stdout: `nmcli> ${secret}\nsuccessfully updated`, notInstalled: false } : { code, stderr, stdout: "", notInstalled: false });

  it("holds the password and the token through a pipe, connects, then lets go of them", async () => {
    const id = await saved();
    const run = edited();
    expect(await connectVpn(db, id, { token: " 654321 " }, run)).toEqual({ ok: true });
    const [hold, up, release] = run.mock.calls.filter(([command]) => command !== "journalctl");
    expect(hold[0]).toBe("sh");
    expect(hold[2]).toContain("set vpn.secrets password = secret654321");
    expect(up.slice(0, 2)).toEqual(["nmcli", ["--wait", "50", "connection", "up", UUID]]);
    expect(up[2]).toBeUndefined();
    expect(release[2]).toContain("remove vpn.secrets");
    expect(run.mock.calls.flatMap(([, args]) => args).join(" ")).not.toContain("654321");
    expect(JSON.stringify(db.select().from(vpns).all())).not.toContain("654321");
  });

  it("stops trying and lets go of the secret when it fails", async () => {
    const id = await saved();
    const run = failingUp("Error: Connection activation failed");
    expect(await connectVpn(db, id, { token: "1" }, run)).toMatchObject({ problem: "connectFailed", detail: "Error: Connection activation failed" });
    const rest = run.mock.calls.filter(([command]) => command !== "journalctl");
    expect(rest[2].slice(0, 2)).toEqual(["nmcli", ["connection", "down", UUID]]);
    expect(rest[3][2]).toContain("remove vpn.secrets");
  });

  it("stops everything at the first refusal, instead of letting it try again with the same token", async () => {
    const id = await saved();
    let finish: (code: number) => void = () => undefined;
    const calls: string[] = [];
    const run = vi.fn<CommandRunner>(async (command, args, secret) => {
      calls.push(`${command} ${args.includes("up") ? "up" : args.includes("down") ? "down" : ""}`.trim());
      if (command === "sh") return { code: 0, stderr: "", stdout: `${secret} successfully updated`, notInstalled: false };
      if (command === "journalctl") return { code: 0, stderr: "", stdout: "AUTH: Received control message: AUTH_FAILED\n", notInstalled: false };
      if (args.includes("up")) {
        const code = await new Promise<number>((resolve) => (finish = resolve));
        return { code, stderr: "Error: timeout", stdout: "", notInstalled: false };
      }
      finish(4);
      return { code: 0, stderr: "", stdout: "", notInstalled: false };
    });
    expect(await connectVpn(db, id, { token: "1" }, run, () => 5000, async () => undefined)).toEqual({ problem: "authRefused", detail: "" });
    expect(calls.filter((call) => call === "nmcli down")).toHaveLength(1);
    expect(calls.at(-1)).toBe("sh");
    expect(run.mock.calls.find(([command]) => command === "journalctl")?.[1]).toContain("@5");
  });

  it("does not take the refusal of another attempt for this one, once connected", async () => {
    const id = await saved();
    const run = edited();
    expect(await connectVpn(db, id, { token: "1" }, run, () => 5000, async () => undefined)).toEqual({ ok: true });
    expect(run.mock.calls.some(([, args]) => args.includes("down"))).toBe(false);
  });

  it("does not try to connect if the secret could not be held", async () => {
    const id = await saved();
    const run = vi.fn<CommandRunner>(async (_command, _args, secret) => ({ code: 1, stderr: "", stdout: `nmcli> ${secret}\nError: nope`, notInstalled: false }));
    const result = await connectVpn(db, id, { token: "99" }, run);
    expect(result).toMatchObject({ problem: "connectFailed" });
    expect(run).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("secret99");
  });

  it("asks for what is missing before trying", async () => {
    const id = await saved();
    const run = nmcli();
    expect(await connectVpn(db, id, {}, run)).toMatchObject({ problem: "tokenNeeded" });
    const bare = await saveVpn(db, null, { ...input, name: "Bare", password: "", tokenAppended: false }, nmcli(), dir).then(idOf);
    expect(await connectVpn(db, bare, {}, run)).toMatchObject({ problem: "passwordNeeded" });
    expect(run).not.toHaveBeenCalled();
    const typed = edited();
    await connectVpn(db, bare, { password: "typed" }, typed);
    expect(typed.mock.calls[0][2]).toContain("password = typed\n");
    expect(db.select().from(vpns).where(eq(vpns.id, bare)).get()?.passwordSecret).toBeNull();
  });

  it("ignores a token this VPN does not take", async () => {
    const id = await saveVpn(db, null, { ...input, name: "Plain", tokenAppended: false }, nmcli(), dir).then(idOf);
    const run = edited();
    await connectVpn(db, id, { token: "123" }, run);
    expect(run.mock.calls[0][2]).toContain("password = secret\n");
  });

  it("hides the password if anything prints it", async () => {
    const id = await saved();
    const result = await connectVpn(db, id, { token: "99" }, failingUp("Error: password = secret99 refused"));
    expect(result).toMatchObject({ problem: "connectFailed" });
    expect(JSON.stringify(result)).not.toContain("secret99");
  });

  it("says when it takes too long", async () => {
    const id = await saved();
    expect(await connectVpn(db, id, { token: "1" }, failingUp("", null))).toMatchObject({ problem: "timeout" });
  });

  it("connects NordLayer to its gateway", async () => {
    const id = await saveVpn(db, null, nord, nmcli(), dir).then(idOf);
    const run = nmcli();
    expect(await connectVpn(db, id, {}, run)).toEqual({ ok: true });
    expect(run.mock.calls[0][0]).toBe("nordlayer");
    expect(run.mock.calls[0][1]).toEqual(["--assume-yes", "connect", "fr-paris"]);
  });
});

describe("listVpns", () => {
  it("says the state of each, and nothing secret", async () => {
    const id = await saved();
    await saveVpn(db, null, nord, nmcli(), dir);
    const run = vi.fn<CommandRunner>(async (command) => ({ code: 0, stderr: "", notInstalled: false, stdout: command === "nmcli" ? `${UUID}:activated\n` : "Login: Not logged in\nVPN: Not Connected\n" }));
    const views = await listVpns(db, run);
    expect(views.find((view) => view.id === id)).toMatchObject({ state: "connected", hasPassword: true, loggedIn: null });
    expect(views.find(({ kind }) => kind === "nordlayer")).toMatchObject({ state: "off", loggedIn: false });
    expect(JSON.stringify(views)).not.toContain("v1:");
    expect(JSON.stringify(views)).not.toContain(UUID);
  });

  it("does not run anything without a VPN, and says when a tool is gone", async () => {
    const run = nmcli();
    expect(await listVpns(db, run)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
    await saved();
    const gone = vi.fn<CommandRunner>(async () => ({ code: 127, stdout: "", stderr: "", notInstalled: true }));
    expect((await listVpns(db, gone))[0].state).toBe("unavailable");
  });
});

describe("removing", () => {
  it("disconnects and deletes through nmcli, profile included", async () => {
    const id = await saved();
    const run = nmcli();
    expect(await disconnectVpn(db, id, run)).toBeNull();
    expect(run.mock.calls[0][1]).toEqual(["connection", "down", UUID]);
    expect(await deleteVpn(db, id, run)).toBeNull();
    expect(run.mock.calls[1][1]).toEqual(["connection", "delete", UUID]);
    expect(db.select().from(vpns).all()).toEqual([]);
  });

  it("keeps it if the profile could not go, unless it is already gone", async () => {
    const id = await saved();
    expect(await deleteVpn(db, id, refusing("Error: not authorized"))).toMatchObject({ problem: "disconnectFailed" });
    expect(db.select().from(vpns).all()).toHaveLength(1);
    expect(await deleteVpn(db, id, refusing("Error: unknown connection"))).toBeNull();
  });

  it("frees the servers that needed it", async () => {
    const id = await saved();
    const server = idOf(saveServer(db, null, { name: "s", kind: "ssh", host: "h", port: null, username: null, auth: "agent", keyPath: null, jumpHost: null, context: null, vpnId: id }));
    await deleteVpn(db, id, nmcli());
    expect(db.select().from(remoteServers).where(eq(remoteServers.id, server)).get()?.vpnId).toBeNull();
  });
});

describe("a server behind a VPN", () => {
  it("is not tried while the VPN is off, and is once it is up", async () => {
    const vpnId = await saved();
    const serverId = idOf(saveServer(db, null, { name: "s", kind: "ssh", host: "h", port: null, username: null, auth: "agent", keyPath: null, jumpHost: null, context: null, vpnId }));
    const off = nmcli("");
    expect(await testConnection(db, { serverId }, off, "/h")).toEqual({ ok: false, failure: "vpnDown", detail: "Villette" });
    expect(off.mock.calls.map(([command]) => command)).toEqual(["nmcli"]);
    const on = nmcli(`${UUID}:activated\n`);
    expect(await testConnection(db, { serverId }, on, "/h")).toEqual({ ok: true });
    expect(on.mock.calls.map(([command]) => command)).toEqual(["nmcli", "ssh"]);
  });

  it("refuses a VPN that does not exist", () => {
    expect(saveServer(db, null, { name: "s", kind: "ssh", host: "h", port: null, username: null, auth: "agent", keyPath: null, jumpHost: null, context: null, vpnId: 999 })).toEqual({ problem: "vpnMissing" });
  });
});

describe("readOvpnSuggestions", () => {
  it("offers the files of the usual folders", async () => {
    expect(await readOvpnSuggestions(dir)).toEqual(["~/v.ovpn"]);
  });
});
