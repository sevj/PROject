import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "./db/client";
import { remoteServers } from "./db/schema";
import type { CommandRunner } from "./run-command";
import { statSync } from "node:fs";
import { assignSshKey, closeSshKey, listSshKeys } from "./ssh-keys";

let home: string;
let db: Db;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "pm-ssh-keys-"));
  const ssh = join(home, ".ssh");
  mkdirSync(ssh);
  for (const name of ["id_work", "id_open"]) {
    writeFileSync(join(ssh, name), "private", { mode: 0o600 });
    writeFileSync(join(ssh, `${name}.pub`), `ssh-ed25519 AAAA ${name}\n`);
  }
  chmodSync(join(ssh, "id_open"), 0o644);
  writeFileSync(join(ssh, "known_hosts"), "");
});
afterAll(() => rmSync(home, { recursive: true, force: true }));
beforeEach(() => {
  db = openDb(":memory:");
});

/** id_work asks for a passphrase and is in the agent; id_open asks for none. */
const run = vi.fn<CommandRunner>(async (command, args) => {
  const file = args.at(-1) ?? "";
  const name = file.includes("id_work") ? "work" : "open";
  if (command === "ssh-add") return { code: 0, stdout: "256 SHA256:work me@work (ED25519)\n", stderr: "", notInstalled: false };
  if (args[0] === "-l") return { code: 0, stdout: `256 SHA256:${name} me@${name} (ED25519)\n`, stderr: "", notInstalled: false };
  if (name === "work") return { code: 1, stdout: "", stderr: "Load key: incorrect passphrase supplied to decrypt private key", notInstalled: false };
  return { code: 0, stdout: "ssh-ed25519 AAAA\n", stderr: "", notInstalled: false };
});

const server = (values: Partial<typeof remoteServers.$inferInsert> & { name: string }) =>
  db.insert(remoteServers).values({ kind: "ssh", host: "h", auth: "agent", ...values }).returning({ id: remoteServers.id }).get().id;

describe("listing", () => {
  it("reads each key, what protects it, and who uses it", async () => {
    const prod = server({ name: "Prod", auth: "key", keyPath: `${home}/.ssh/id_work` });
    server({ name: "Alias", auth: "alias" });
    const { keys, servers } = await listSshKeys(db, run, home);
    expect(keys.map(({ name }) => name)).toEqual(["id_open", "id_work"]);
    expect(keys[1]).toMatchObject({ path: "~/.ssh/id_work", type: "ED25519", fingerprint: "SHA256:work", protected: true, inAgent: true, tooOpen: false, usedBy: [{ id: prod, name: "Prod" }] });
    expect(keys[0]).toMatchObject({ protected: false, inAgent: false, tooOpen: true, publicKey: "ssh-ed25519 AAAA id_open", usedBy: [] });
    expect(servers.map(({ name }) => name)).toEqual(["Prod"]);
  });
});

describe("assigning", () => {
  it("gives a key to a server, then takes it back to the agent, keeping a kept password", async () => {
    const id = server({ name: "Prod", auth: "password", passwordSecret: "sealed" });
    expect(await assignSshKey(db, id, "~/.ssh/id_work", home)).toBeNull();
    expect(db.select().from(remoteServers).where(eq(remoteServers.id, id)).get()).toMatchObject({ auth: "key", keyPath: "~/.ssh/id_work", passwordSecret: "sealed" });
    expect(await assignSshKey(db, id, null, home)).toBeNull();
    expect(db.select().from(remoteServers).where(eq(remoteServers.id, id)).get()).toMatchObject({ auth: "agent", keyPath: null });
  });

  it("refuses a key that is not in ~/.ssh, and an alias", async () => {
    const id = server({ name: "Prod" });
    expect(await assignSshKey(db, id, "~/.ssh/known_hosts", home)).toBe("keyMissing");
    expect(await assignSshKey(db, id, "/etc/shadow", home)).toBe("keyMissing");
    expect(await assignSshKey(db, server({ name: "Alias", auth: "alias" }), "~/.ssh/id_work", home)).toBe("serverMissing");
  });
});

describe("closing", () => {
  it("lets only the owner read a key of ~/.ssh, and nothing else", async () => {
    expect(await closeSshKey("id_open", home)).toBe(true);
    expect(statSync(join(home, ".ssh", "id_open")).mode & 0o777).toBe(0o600);
    expect(await closeSshKey("known_hosts", home)).toBe(false);
    expect(await closeSshKey("../.ssh/id_open", home)).toBe(false);
  });
});
