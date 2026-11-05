import { chmod, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { privateKeysAmong } from "@/lib/remote-servers";
import { parseAgentPrints, parseKeyPrint, sameKey, tooOpen } from "@/lib/ssh-keys";
import type { Db } from "./db/client";
import { remoteServers } from "./db/schema";
import { type CommandRunner, runCommand } from "./run-command";

export type SshKeyView = {
  name: string;
  /** As a server stores it: `~/.ssh/<name>`. */
  path: string;
  type: string | null;
  bits: number | null;
  fingerprint: string | null;
  comment: string;
  /** Asks for a passphrase; null when it could not be told. */
  protected: boolean | null;
  inAgent: boolean;
  tooOpen: boolean;
  publicKey: string;
  usedBy: { id: number; name: string }[];
};

/** An SSH server that can be told which key to use: an alias of ~/.ssh/config decides for itself. */
export type KeyTarget = { id: number; name: string; auth: string | null; keyPath: string | null };

export type SshKeys = { keys: SshKeyView[]; servers: KeyTarget[] };

function keyTargets(db: Db): KeyTarget[] {
  return db
    .select({ id: remoteServers.id, name: remoteServers.name, kind: remoteServers.kind, auth: remoteServers.auth, keyPath: remoteServers.keyPath })
    .from(remoteServers)
    .all()
    .filter(({ kind, auth }) => kind === "ssh" && auth !== "alias")
    .map(({ id, name, auth, keyPath }) => ({ id, name, auth, keyPath }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The private keys of ~/.ssh, known by their public half. Whether one is protected is told by
 * asking ssh-keygen to open it with an empty passphrase: it never prompts, and nothing leaves.
 */
export async function listSshKeys(db: Db, run: CommandRunner = runCommand, home = homedir()): Promise<SshKeys> {
  const dir = join(home, ".ssh");
  const names = privateKeysAmong(await readdir(dir).catch(() => [] as string[]));
  const servers = keyTargets(db);
  const agent = await run("ssh-add", ["-l"]);
  const held = parseAgentPrints(agent.stdout);
  const keys = await Promise.all(
    names.map(async (name): Promise<SshKeyView> => {
      const file = join(dir, name);
      const [print, open, info, publicKey] = await Promise.all([
        run("ssh-keygen", ["-l", "-f", `${file}.pub`]),
        run("ssh-keygen", ["-y", "-P", "", "-f", file]),
        stat(file).catch(() => null),
        readFile(`${file}.pub`, "utf8").catch(() => ""),
      ]);
      const read = print.code === 0 ? parseKeyPrint(print.stdout) : null;
      const path = `~/.ssh/${name}`;
      return {
        name,
        path,
        type: read?.type ?? null,
        bits: read?.bits ?? null,
        fingerprint: read?.fingerprint ?? null,
        comment: read?.comment ?? "",
        protected: open.code === 0 ? false : /passphrase/i.test(open.stderr) ? true : null,
        inAgent: read ? held.has(read.fingerprint) : false,
        tooOpen: info ? tooOpen(info.mode) : false,
        publicKey: publicKey.trim(),
        usedBy: servers.filter((server) => server.auth === "key" && server.keyPath && sameKey(server.keyPath, path, home)).map(({ id, name }) => ({ id, name })),
      };
    }),
  );
  return { keys, servers };
}

export type AssignProblem = "serverMissing" | "keyMissing";

/**
 * Gives a server this key, used alone (`IdentitiesOnly`), or with null takes it back: the server
 * then goes through the agent. A kept password stays, for when it goes back to a password.
 */
export async function assignSshKey(db: Db, serverId: number, keyPath: string | null, home = homedir()): Promise<AssignProblem | null> {
  const server = keyTargets(db).find(({ id }) => id === serverId);
  if (!server) return "serverMissing";
  if (keyPath === null) {
    if (server.auth === "key") db.update(remoteServers).set({ auth: "agent", keyPath: null }).where(eq(remoteServers.id, serverId)).run();
    return null;
  }
  const names = privateKeysAmong(await readdir(join(home, ".ssh")).catch(() => [] as string[]));
  if (!names.some((name) => `~/.ssh/${name}` === keyPath)) return "keyMissing";
  db.update(remoteServers).set({ auth: "key", keyPath }).where(eq(remoteServers.id, serverId)).run();
  return null;
}

/** Only the owner may read a private key, or ssh ignores it. Only a key listed in ~/.ssh is touched. */
export async function closeSshKey(name: string, home = homedir()): Promise<boolean> {
  const names = privateKeysAmong(await readdir(join(home, ".ssh")).catch(() => [] as string[]));
  if (!names.includes(name)) return false;
  return chmod(join(home, ".ssh", name), 0o600).then(
    () => true,
    () => false,
  );
}
