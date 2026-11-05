import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { eq } from "drizzle-orm";
import { cleanLogText } from "@/lib/container-logs";
import {
  editorKeepsIntact,
  fullPassword,
  hasAuthFailure,
  isGateway,
  isOneLine,
  isOvpnPath,
  isVpnUsername,
  NM_ACTIVE_ARGUMENTS,
  nmDeleteArguments,
  NM_RELEASE_SECRET_SCRIPT,
  nmDownArguments,
  nmEditArguments,
  nmEditWorked,
  nmHoldSecretScript,
  nmImportArguments,
  nmJournalArguments,
  nmSetupArguments,
  nmUpArguments,
  ovpnFilesAmong,
  ovpnForImport,
  parseImportedUuid,
  parseNmActive,
  parseNordStatus,
  readSudoLog,
  sudoOpenvpnCommand,
  sudoRemovalCommand,
  sudoSetupCommands,
  sudoVpnPaths,
  vpnSlug,
  type VpnState,
} from "@/lib/vpn";
import type { Db } from "./db/client";
import { remoteServers, vpns } from "./db/schema";
import { type CommandRunner, runCommand } from "./run-command";
import { decryptSecret, encryptSecret } from "./secrets";
import { realSudoDriver, type SudoDriver, sudoLogFile } from "./vpn-sudo";

export type VpnKind = "openvpn" | "sudo_openvpn" | "nordlayer";

export type VpnInput = {
  name: string;
  kind: VpnKind;
  configPath: string | null;
  username: string | null;
  /** Empty keeps the one already remembered. */
  password: string;
  tokenAppended: boolean;
  gateway: string | null;
};

/** What leaves the server: never a password, or the profile's id. */
export type VpnView = {
  id: number;
  name: string;
  kind: VpnKind;
  configPath: string | null;
  username: string | null;
  gateway: string | null;
  hasPassword: boolean;
  tokenAppended: boolean;
  state: VpnState;
  /** Null when it does not apply. */
  loggedIn: boolean | null;
  /** With sudo: what to paste once, whether it is in place, and how to take it away. */
  setup: { commands: string[]; ready: boolean; removal: string } | null;
  usedBy: string[];
};

export type VpnProblem =
  | "nameMissing"
  | "nameTaken"
  | "fileInvalid"
  | "fileMissing"
  | "usernameInvalid"
  | "passwordInvalid"
  | "gatewayInvalid"
  | "passwordNeeded"
  | "tokenNeeded"
  | "gone"
  | "nmcliMissing"
  | "nordlayerMissing"
  | "sudoRuleMissing"
  | "importFailed"
  | "authRefused"
  | "connectFailed"
  | "disconnectFailed"
  | "timeout";

export type VpnFailure = { problem: VpnProblem; detail: string };

const fail = (problem: VpnProblem, detail = ""): VpnFailure => ({ problem, detail });
const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
const lastLine = (output: string, secret?: string) => {
  const line = output.split(/\r?\n/).map(cleanLogText).filter(Boolean).at(-1) ?? "";
  return (secret ? line.replaceAll(secret, "***") : line).slice(0, 300);
};

/** nmcli waits this long, and is killed a little later if it does not stop by itself. */
const CONNECT_WAIT_SECONDS = 50;
const CONNECT_TIMEOUT_MS = 60_000;
const WATCH_MS = 500;

type Row = typeof vpns.$inferSelect;

const pathsOf = (row: Row, uid: number) => sudoVpnPaths(row.sudoSlug ?? vpnSlug(row.name), uid);

async function readStates(rows: Row[], run: CommandRunner, driver: SudoDriver) {
  const [nm, nord, sudo] = await Promise.all([
    rows.some(({ kind }) => kind === "openvpn") ? run("nmcli", NM_ACTIVE_ARGUMENTS) : null,
    rows.some(({ kind }) => kind === "nordlayer") ? run("nordlayer", ["status"]) : null,
    Promise.all(
      rows.filter(({ kind }) => kind === "sudo_openvpn").map(async (row) => [row.id, await driver.state(pathsOf(row, driver.uid).socket)] as const),
    ),
  ]);
  return {
    nm: nm && nm.code === 0 ? parseNmActive(nm.stdout) : null,
    nord: nord && !nord.notInstalled ? parseNordStatus(nord.stdout) : null,
    sudo: new Map(sudo),
  };
}

function stateOf(row: Row, states: Awaited<ReturnType<typeof readStates>>): VpnState {
  if (row.kind === "nordlayer") return states.nord?.state ?? "unavailable";
  if (row.kind === "sudo_openvpn") return states.sudo.get(row.id) ?? "off";
  if (!states.nm) return "unavailable";
  return states.nm.get(row.connectionUuid ?? "") ?? "off";
}

export async function listVpns(db: Db, run: CommandRunner = runCommand, driver: SudoDriver = realSudoDriver): Promise<VpnView[]> {
  const rows = db.select().from(vpns).all().sort((a, b) => a.name.localeCompare(b.name));
  if (rows.length === 0) return [];
  const states = await readStates(rows, run, driver);
  const readiness = new Map(
    await Promise.all(
      rows
        .filter(({ kind }) => kind === "sudo_openvpn")
        // Asks sudo whether this exact command is allowed, without ever prompting.
        .map(async (row) => [row.id, (await run("sudo", ["-n", "-l", ...sudoOpenvpnCommand(pathsOf(row, driver.uid))])).code === 0] as const),
    ),
  );
  const servers = db.select({ name: remoteServers.name, vpnId: remoteServers.vpnId }).from(remoteServers).all();
  return rows.map((row) => ({
    // Field by field, so that the secret, or one added later, cannot leave by accident.
    id: row.id,
    name: row.name,
    kind: row.kind,
    configPath: row.configPath,
    username: row.username,
    gateway: row.gateway,
    hasPassword: row.passwordSecret !== null,
    tokenAppended: row.tokenAppended,
    state: stateOf(row, states),
    loggedIn: row.kind === "nordlayer" ? (states.nord?.loggedIn ?? false) : null,
    setup:
      row.kind === "sudo_openvpn"
        ? {
            commands: sudoSetupCommands(row.configPath ?? "", pathsOf(row, driver.uid), driver.user),
            ready: readiness.get(row.id) ?? false,
            removal: sudoRemovalCommand(pathsOf(row, driver.uid)),
          }
        : null,
    usedBy: servers.filter(({ vpnId }) => vpnId === row.id).map(({ name }) => name).sort(),
  }));
}

export type ActiveVpn = { id: number; name: string; state: VpnState };

/** For the top bar, every few seconds: only what is up, without the rest of `listVpns`. */
export async function readActiveVpns(db: Db, run: CommandRunner = runCommand, driver: SudoDriver = realSudoDriver): Promise<ActiveVpn[]> {
  const rows = db.select().from(vpns).all().sort((a, b) => a.name.localeCompare(b.name));
  if (rows.length === 0) return [];
  const states = await readStates(rows, run, driver);
  return rows
    .map(({ id, name, ...row }) => ({ id, name, state: stateOf({ id, name, ...row }, states) }))
    .filter(({ state }) => state === "connected" || state === "connecting");
}

/** The name of the VPN this server needs when it is not up. Off or unknown, both mean no answer from the server. */
export async function downVpnName(db: Db, vpnId: number | null, run: CommandRunner, driver: SudoDriver = realSudoDriver): Promise<string | null> {
  if (vpnId === null) return null;
  const row = db.select().from(vpns).where(eq(vpns.id, vpnId)).get();
  if (!row) return null;
  return stateOf(row, await readStates([row], run, driver)) === "connected" ? null : row.name;
}

const expandHome = (path: string, home: string) => (path.startsWith("~/") ? join(home, path.slice(2)) : path);

/**
 * The user's file stays as it is: a copy is what gets adapted. It can hold a private key, so it
 * lies in a folder only this user can open, under the same name, which the profile takes after.
 */
async function importCopy(file: string, run: CommandRunner) {
  const folder = await mkdtemp(join(tmpdir(), "pm-ovpn-"));
  try {
    const copy = join(folder, basename(file));
    await writeFile(copy, ovpnForImport(await readFile(file, "utf8")), { mode: 0o600 });
    return await run("nmcli", nmImportArguments(copy));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

export async function saveVpn(db: Db, id: number | null, raw: VpnInput, run: CommandRunner = runCommand, home = homedir()): Promise<{ id: number } | VpnFailure> {
  const name = text(raw.name);
  if (!name) return fail("nameMissing");
  const taken = db.select({ id: vpns.id }).from(vpns).where(eq(vpns.name, name)).get();
  if (taken && taken.id !== id) return fail("nameTaken");
  const current = id === null ? null : db.select().from(vpns).where(eq(vpns.id, id)).get();
  if (id !== null && !current) return fail("gone");
  const password = typeof raw.password === "string" ? raw.password : "";
  if (!isOneLine(password)) return fail("passwordInvalid");
  const passwordSecret = password !== "" ? encryptSecret(password) : (current?.passwordSecret ?? null);

  if ((current?.kind ?? raw.kind) === "nordlayer") {
    const gateway = text(raw.gateway);
    if (!gateway || !isGateway(gateway)) return fail("gatewayInvalid");
    const values = { name, gateway };
    if (current) {
      db.update(vpns).set(values).where(eq(vpns.id, current.id)).run();
      return { id: current.id };
    }
    return { id: db.insert(vpns).values({ ...values, kind: "nordlayer" }).returning({ id: vpns.id }).get().id };
  }

  const username = text(raw.username);
  if (username && !isVpnUsername(username)) return fail("usernameInvalid");
  const common = { name, username, passwordSecret, tokenAppended: raw.tokenAppended === true };
  if ((current?.kind ?? raw.kind) === "sudo_openvpn") {
    if (!username) return fail("usernameInvalid");
    if (current) {
      db.update(vpns).set(common).where(eq(vpns.id, current.id)).run();
      return { id: current.id };
    }
    const source = text(raw.configPath);
    if (!source || !isOvpnPath(source)) return fail("fileInvalid");
    if (!existsSync(expandHome(source, home))) return fail("fileMissing");
    const sudoSlug = vpnSlug(name);
    // It names a file and a sudo rule, which two VPNs cannot share.
    if (db.select({ id: vpns.id }).from(vpns).where(eq(vpns.sudoSlug, sudoSlug)).get()) return fail("nameTaken");
    return { id: db.insert(vpns).values({ ...common, kind: "sudo_openvpn", configPath: source, sudoSlug }).returning({ id: vpns.id }).get().id };
  }
  let uuid = current?.connectionUuid ?? null;
  let configPath = current?.configPath ?? null;
  if (!current) {
    configPath = text(raw.configPath);
    if (!configPath || !isOvpnPath(configPath)) return fail("fileInvalid");
    const file = expandHome(configPath, home);
    if (!existsSync(file)) return fail("fileMissing");
    const imported = await importCopy(file, run);
    if (imported.notInstalled) return fail("nmcliMissing");
    uuid = imported.code === 0 ? parseImportedUuid(imported.stdout) : null;
    if (!uuid) return fail("importFailed", lastLine(imported.stderr || imported.stdout));
  }
  const setup = await run("nmcli", nmSetupArguments(uuid ?? "", name, username));
  if (setup.code !== 0) {
    // A profile half set up would ask for its password by itself: it does not stay.
    if (!current && uuid) await run("nmcli", nmDeleteArguments(uuid));
    return fail("importFailed", lastLine(setup.stderr));
  }
  if (current) {
    db.update(vpns).set(common).where(eq(vpns.id, current.id)).run();
    return { id: current.id };
  }
  return { id: db.insert(vpns).values({ ...common, kind: "openvpn", configPath, connectionUuid: uuid }).returning({ id: vpns.id }).get().id };
}

/**
 * The way that works where a server refuses NetworkManager: the same openvpn a person runs by hand,
 * which stops at the first refusal by itself. It outlives the app, which finds it again by its socket.
 */
async function connectThroughSudo(row: Row, secret: string, driver: SudoDriver, now: () => number, pause: (ms: number) => Promise<void>): Promise<{ ok: true } | VpnFailure> {
  const paths = pathsOf(row, driver.uid);
  if ((await driver.state(paths.socket)) === "connected") return { ok: true };
  const logFile = sudoLogFile(row.sudoSlug ?? vpnSlug(row.name));
  await driver.launch(sudoOpenvpnCommand(paths), `${row.username}\n${secret}`, logFile);
  const deadline = now() + CONNECT_WAIT_SECONDS * 1000;
  while (now() < deadline) {
    const log = await driver.readLog(logFile);
    const end = readSudoLog(log);
    if (end === "refused") return fail("authRefused");
    if (end === "ruleMissing") return fail("sudoRuleMissing");
    if (end === "ended") return fail("connectFailed", lastLine(log, secret));
    if ((await driver.state(paths.socket)) === "connected") return { ok: true };
    await pause(WATCH_MS);
  }
  await driver.stop(paths.socket);
  return fail("timeout");
}

export async function connectVpn(
  db: Db,
  id: number,
  given: { password?: unknown; token?: unknown },
  run: CommandRunner = runCommand,
  now: () => number = Date.now,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  driver: SudoDriver = realSudoDriver,
): Promise<{ ok: true } | VpnFailure> {
  const row = db.select().from(vpns).where(eq(vpns.id, id)).get();
  if (!row) return fail("gone");
  if (row.kind === "nordlayer") {
    const ran = await run("nordlayer", ["--assume-yes", "connect", row.gateway ?? ""], undefined, CONNECT_TIMEOUT_MS);
    if (ran.notInstalled) return fail("nordlayerMissing");
    if (ran.code === null) return fail("timeout");
    return ran.code === 0 ? { ok: true } : fail("connectFailed", lastLine(ran.stderr || ran.stdout));
  }
  const typed = typeof given.password === "string" && given.password !== "" ? given.password : null;
  const token = typeof given.token === "string" && given.token.trim() !== "" ? given.token.trim() : null;
  const password = typed ?? (row.passwordSecret ? decryptSecret(row.passwordSecret) : null);
  if (!password) return fail("passwordNeeded");
  if (row.tokenAppended && !token) return fail("tokenNeeded");
  const secret = fullPassword(password, row.tokenAppended ? token : null);
  if (!isOneLine(secret)) return fail("passwordInvalid");
  if (row.kind === "sudo_openvpn") return connectThroughSudo(row, secret, driver, now, pause);
  if (!editorKeepsIntact(secret)) return fail("passwordInvalid");
  const uuid = row.connectionUuid ?? "";
  const held = await run("sh", nmEditArguments(uuid), nmHoldSecretScript(secret));
  if (held.code === 127) return fail("nmcliMissing");
  if (held.code !== 0 || !nmEditWorked(held.stdout)) return fail("connectFailed", lastLine(held.stderr || held.stdout, secret));
  const startedAt = Math.floor(now() / 1000);
  let settled = false;
  let refused = false;
  const up = run("nmcli", nmUpArguments(uuid, CONNECT_WAIT_SECONDS), undefined, CONNECT_TIMEOUT_MS).finally(() => {
    settled = true;
  });
  // NetworkManager answers a refusal by trying again at once, with the same token, several times in
  // ten seconds: enough for a server to lock the account. So the first refusal stops everything.
  const watch = (async () => {
    while (!settled) {
      const journal = await run("journalctl", nmJournalArguments(startedAt));
      if (hasAuthFailure(journal.stdout)) {
        refused = true;
        await run("nmcli", nmDownArguments(uuid));
        return;
      }
      await pause(WATCH_MS);
    }
  })();
  const ran = await up;
  await watch;
  if (ran.code !== 0 && !refused) await run("nmcli", nmDownArguments(uuid));
  await run("sh", nmEditArguments(uuid), NM_RELEASE_SECRET_SCRIPT);
  if (refused) return fail("authRefused");
  if (ran.notInstalled) return fail("nmcliMissing");
  if (ran.code === null) return fail("timeout");
  return ran.code === 0 ? { ok: true } : fail("connectFailed", lastLine(ran.stderr || ran.stdout, secret));
}

export async function disconnectVpn(db: Db, id: number, run: CommandRunner = runCommand, driver: SudoDriver = realSudoDriver): Promise<VpnFailure | null> {
  const row = db.select().from(vpns).where(eq(vpns.id, id)).get();
  if (!row) return fail("gone");
  if (row.kind === "sudo_openvpn") return (await driver.stop(pathsOf(row, driver.uid).socket)) ? null : fail("disconnectFailed");
  const ran = row.kind === "nordlayer" ? await run("nordlayer", ["--assume-yes", "disconnect"]) : await run("nmcli", nmDownArguments(row.connectionUuid ?? ""));
  if (ran.notInstalled) return fail(row.kind === "nordlayer" ? "nordlayerMissing" : "nmcliMissing");
  return ran.code === 0 ? null : fail("disconnectFailed", lastLine(ran.stderr || ran.stdout));
}

/** Its profile goes with it: left behind, it would stay in the system's settings with no way back here. */
export async function deleteVpn(db: Db, id: number, run: CommandRunner = runCommand, driver: SudoDriver = realSudoDriver): Promise<VpnFailure | null> {
  const row = db.select().from(vpns).where(eq(vpns.id, id)).get();
  if (!row) return null;
  if (row.kind === "sudo_openvpn") await driver.stop(pathsOf(row, driver.uid).socket);
  if (row.connectionUuid) {
    const ran = await run("nmcli", nmDeleteArguments(row.connectionUuid));
    if (ran.notInstalled) return fail("nmcliMissing");
    // Already deleted from the system's settings is what was wanted.
    if (ran.code !== 0 && !/unknown connection|not found/i.test(ran.stderr)) return fail("disconnectFailed", lastLine(ran.stderr));
  }
  // Said here too: a database migrated before the rule was corrected does not have it.
  db.update(remoteServers).set({ vpnId: null }).where(eq(remoteServers.vpnId, id)).run();
  db.delete(vpns).where(eq(vpns.id, id)).run();
  return null;
}

/** Where such files usually lie: nothing deep, and only their names. */
export async function readOvpnSuggestions(home = homedir()): Promise<string[]> {
  const found = await Promise.all(
    ["", "Projects", "Downloads", "Téléchargements"].map(async (folder) => {
      const files = await readdir(join(home, folder)).catch(() => [] as string[]);
      return ovpnFilesAmong(files).map((file) => `~/${folder ? `${folder}/` : ""}${file}`);
    }),
  );
  return found.flat();
}
