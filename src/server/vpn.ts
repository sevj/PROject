import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { eq } from "drizzle-orm";
import { cleanLogText } from "@/lib/container-logs";
import {
  editorKeepsIntact,
  fullPassword,
  gpRemovalCommand,
  gpRuleCommand,
  gpSamlArguments,
  gpScript,
  gpSetupCommands,
  gpWasConnected,
  hasAuthFailure,
  isGateway,
  isOneLine,
  isOrganization,
  isOvpnPath,
  isWireguardPath,
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
  nmWireguardSetupArguments,
  ovpnForImport,
  parseImportedUuid,
  parseNmActive,
  formatGpRoutes,
  parseGpRoutes,
  parseGpSaml,
  parseDnsDomains,
  parseNordStatus,
  readGpLog,
  readSudoLog,
  sudoGpCommand,
  sudoOpenvpnCommand,
  sudoRemovalCommand,
  sudoRuleAllows,
  sudoRuleInPlace,
  sudoSetupCommands,
  sudoVpnPaths,
  vpnSlug,
  type VpnState,
  wireguardInterface,
  withoutCookies,
} from "@/lib/vpn";
import type { Db } from "./db/client";
import { remoteServers, vpns } from "./db/schema";
import { type CommandRunner, runCommand } from "./run-command";
import { decryptSecret, encryptSecret } from "./secrets";
import { type GpDriver, realGpDriver } from "./vpn-gp";
import { realSudoDriver, type SudoDriver, sudoLogFile } from "./vpn-sudo";

export type VpnKind = "openvpn" | "sudo_openvpn" | "nordlayer" | "globalprotect" | "wireguard";

export type VpnInput = {
  name: string;
  kind: VpnKind;
  configPath: string | null;
  username: string | null;
  /** Empty keeps the one already remembered. */
  password: string;
  tokenAppended: boolean;
  gateway: string | null;
  organization?: string | null;
  routes?: string | null;
  dnsDomains?: string | null;
};

/** What leaves the server: never a password, or the profile's id. */
export type VpnView = {
  id: number;
  name: string;
  kind: VpnKind;
  configPath: string | null;
  username: string | null;
  gateway: string | null;
  organization: string | null;
  routes: string | null;
  dnsDomains: string | null;
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
  | "portalInvalid"
  | "routesInvalid"
  | "domainsInvalid"
  | "gpSamlMissing"
  | "samlFailed"
  | "organizationInvalid"
  | "passwordNeeded"
  | "tokenNeeded"
  | "gone"
  | "nmcliMissing"
  | "nordlayerMissing"
  | "sudoRuleMissing"
  | "importFailed"
  | "authRefused"
  | "connectFailed"
  | "noAnswer"
  | "tunnelFailed"
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
/** The time to type a password and a code in Microsoft's window. */
const SAML_TIMEOUT_MS = 5 * 60_000;
const WATCH_MS = 500;

type Row = typeof vpns.$inferSelect;

const slugOf = (row: Row) => row.sudoSlug ?? vpnSlug(row.name);
const pathsOf = (row: Row, uid: number) => sudoVpnPaths(slugOf(row), uid);

async function gpState(row: Row, gp: GpDriver): Promise<VpnState> {
  const slug = slugOf(row);
  if (!(await gp.alive(slug))) return (await gp.ended(slug)) && gpWasConnected(await gp.readLog(slug)) ? "lost" : "off";
  return readGpLog(await gp.readLog(slug)) === "connected" ? "connected" : "connecting";
}

async function readStates(rows: Row[], run: CommandRunner, driver: SudoDriver, gp: GpDriver) {
  const [nm, nord, sudo, globalprotect] = await Promise.all([
    rows.some(({ kind }) => kind === "openvpn" || kind === "wireguard") ? run("nmcli", NM_ACTIVE_ARGUMENTS) : null,
    rows.some(({ kind }) => kind === "nordlayer") ? run("nordlayer", ["status"]) : null,
    Promise.all(
      rows.filter(({ kind }) => kind === "sudo_openvpn").map(async (row) => [row.id, await driver.state(pathsOf(row, driver.uid).socket)] as const),
    ),
    Promise.all(rows.filter(({ kind }) => kind === "globalprotect").map(async (row) => [row.id, await gpState(row, gp)] as const)),
  ]);
  return {
    nm: nm && nm.code === 0 ? parseNmActive(nm.stdout) : null,
    nord: nord && !nord.notInstalled ? parseNordStatus(nord.stdout) : null,
    sudo: new Map([...sudo, ...globalprotect]),
  };
}

function stateOf(row: Row, states: Awaited<ReturnType<typeof readStates>>): VpnState {
  if (row.kind === "nordlayer") return states.nord?.state ?? "unavailable";
  if (row.kind === "sudo_openvpn" || row.kind === "globalprotect") return states.sudo.get(row.id) ?? "off";
  if (!states.nm) return "unavailable";
  return states.nm.get(row.connectionUuid ?? "") ?? "off";
}

function setupOf(row: Row, listing: string, driver: SudoDriver, scripts: Map<number, string>): VpnView["setup"] {
  const paths = pathsOf(row, driver.uid);
  if (row.kind === "sudo_openvpn") {
    return { commands: sudoSetupCommands(row.configPath ?? "", paths, driver.user), ready: sudoRuleInPlace(listing, paths), removal: sudoRemovalCommand(paths) };
  }
  if (row.kind === "globalprotect") {
    const slug = slugOf(row);
    // Its script names the portal: changed here, it must be written again.
    const routes = parseGpRoutes(row.routes ?? "") ?? [];
    const ready = sudoRuleAllows(listing, gpRuleCommand(slug)) && scripts.get(row.id) === gpScript(slug, row.gateway ?? "", routes);
    return { commands: gpSetupCommands(slug, paths.rule, row.gateway ?? "", routes, driver.user), ready, removal: gpRemovalCommand(slug, paths.rule) };
  }
  return null;
}

const withSudoRule = (kind: VpnKind) => kind === "sudo_openvpn" || kind === "globalprotect";

export async function listVpns(db: Db, run: CommandRunner = runCommand, driver: SudoDriver = realSudoDriver, gp: GpDriver = realGpDriver): Promise<VpnView[]> {
  const rows = db.select().from(vpns).all().sort((a, b) => a.name.localeCompare(b.name));
  if (rows.length === 0) return [];
  const states = await readStates(rows, run, driver, gp);
  // Lists the rules, which never prompts.
  const listing = rows.some(({ kind }) => withSudoRule(kind)) ? (await run("sudo", ["-n", "-l"])).stdout : "";
  const scripts = new Map(await Promise.all(rows.filter(({ kind }) => kind === "globalprotect").map(async (row) => [row.id, await gp.readScript(slugOf(row))] as const)));
  const servers = db.select({ name: remoteServers.name, vpnId: remoteServers.vpnId }).from(remoteServers).all();
  return rows.map((row) => ({
    // Field by field, so that the secret, or one added later, cannot leave by accident.
    id: row.id,
    name: row.name,
    kind: row.kind,
    configPath: row.configPath,
    username: row.username,
    gateway: row.gateway,
    organization: row.organization,
    routes: row.routes,
    dnsDomains: row.dnsDomains,
    hasPassword: row.passwordSecret !== null,
    tokenAppended: row.tokenAppended,
    state: stateOf(row, states),
    loggedIn: row.kind === "nordlayer" ? (states.nord?.loggedIn ?? false) : null,
    setup: setupOf(row, listing, driver, scripts),
    usedBy: servers.filter(({ vpnId }) => vpnId === row.id).map(({ name }) => name).sort(),
  }));
}

export type ActiveVpn = { id: number; name: string; state: VpnState };

/** What the top bar's menu needs to show a VPN and connect it, without the sudo rules of `listVpns`. */
export type VpnStatus = Pick<VpnView, "id" | "name" | "kind" | "state" | "hasPassword" | "tokenAppended" | "loggedIn">;

/** For the top bar, every few seconds. */
export async function readVpnStatuses(db: Db, run: CommandRunner = runCommand, driver: SudoDriver = realSudoDriver, gp: GpDriver = realGpDriver): Promise<VpnStatus[]> {
  const rows = db.select().from(vpns).all().sort((a, b) => a.name.localeCompare(b.name));
  if (rows.length === 0) return [];
  const states = await readStates(rows, run, driver, gp);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    state: stateOf(row, states),
    hasPassword: row.passwordSecret !== null,
    tokenAppended: row.tokenAppended,
    loggedIn: row.kind === "nordlayer" ? (states.nord?.loggedIn ?? false) : null,
  }));
}

/** Only what is up. */
export async function readActiveVpns(db: Db, run: CommandRunner = runCommand, driver: SudoDriver = realSudoDriver, gp: GpDriver = realGpDriver): Promise<ActiveVpn[]> {
  return (await readVpnStatuses(db, run, driver, gp))
    .filter(({ state }) => state === "connected" || state === "connecting")
    .map(({ id, name, state }) => ({ id, name, state }));
}

/** The name of the VPN this server needs when it is not up. Off or unknown, both mean no answer from the server. */
export async function downVpnName(db: Db, vpnId: number | null, run: CommandRunner, driver: SudoDriver = realSudoDriver, gp: GpDriver = realGpDriver): Promise<string | null> {
  if (vpnId === null) return null;
  const row = db.select().from(vpns).where(eq(vpns.id, vpnId)).get();
  if (!row) return null;
  return stateOf(row, await readStates([row], run, driver, gp)) === "connected" ? null : row.name;
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

/**
 * Under a name NetworkManager makes the interface's: the user's file keeps its own. It holds the
 * private key, so the copy lies in a folder only this user can open, and goes at once.
 */
async function importWireguardCopy(file: string, slug: string, run: CommandRunner) {
  const folder = await mkdtemp(join(tmpdir(), "pm-wg-"));
  try {
    const copy = join(folder, `${wireguardInterface(slug, randomBytes(2).toString("hex"))}.conf`);
    await writeFile(copy, await readFile(file, "utf8"), { mode: 0o600 });
    return await run("nmcli", nmImportArguments(copy, "wireguard"));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function saveWireguard(db: Db, name: string, current: Row | null, raw: VpnInput, run: CommandRunner, home: string): Promise<{ id: number } | VpnFailure> {
  const domains = parseDnsDomains(typeof raw.dnsDomains === "string" ? raw.dnsDomains : "");
  if (!domains) return fail("domainsInvalid");
  let uuid = current?.connectionUuid ?? null;
  let configPath = current?.configPath ?? null;
  if (!current) {
    configPath = text(raw.configPath);
    if (!configPath || !isWireguardPath(configPath)) return fail("fileInvalid");
    const file = expandHome(configPath, home);
    if (!existsSync(file)) return fail("fileMissing");
    const imported = await importWireguardCopy(file, vpnSlug(name), run);
    if (imported.notInstalled) return fail("nmcliMissing");
    uuid = imported.code === 0 ? parseImportedUuid(imported.stdout) : null;
    if (!uuid) return fail("importFailed", lastLine(imported.stderr || imported.stdout));
  }
  const setup = await run("nmcli", nmWireguardSetupArguments(uuid ?? "", name, domains));
  if (setup.code !== 0) {
    // Left there, it would come up on every boot with no way to it from here.
    if (!current && uuid) await run("nmcli", nmDeleteArguments(uuid));
    return fail("importFailed", lastLine(setup.stderr));
  }
  const dnsDomains = domains.length > 0 ? domains.join(" ") : null;
  if (current) {
    db.update(vpns).set({ name, dnsDomains }).where(eq(vpns.id, current.id)).run();
    return { id: current.id };
  }
  // NetworkManager brings an imported tunnel up at once: connecting is for the user to ask.
  await run("nmcli", nmDownArguments(uuid ?? ""));
  return { id: db.insert(vpns).values({ name, kind: "wireguard", configPath, connectionUuid: uuid, dnsDomains }).returning({ id: vpns.id }).get().id };
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

  if ((current?.kind ?? raw.kind) === "wireguard") return saveWireguard(db, name, current ?? null, raw, run, home);

  if ((current?.kind ?? raw.kind) === "nordlayer") {
    const gateway = text(raw.gateway);
    if (!gateway || !isGateway(gateway)) return fail("gatewayInvalid");
    const organization = text(raw.organization);
    if (organization && !isOrganization(organization)) return fail("organizationInvalid");
    const values = { name, gateway, organization };
    if (current) {
      db.update(vpns).set(values).where(eq(vpns.id, current.id)).run();
      return { id: current.id };
    }
    return { id: db.insert(vpns).values({ ...values, kind: "nordlayer" }).returning({ id: vpns.id }).get().id };
  }

  if ((current?.kind ?? raw.kind) === "globalprotect") {
    // The password and the second factor go to Microsoft, in its own window: nothing is kept here.
    const gateway = text(raw.gateway);
    if (!gateway || !isGateway(gateway)) return fail("portalInvalid");
    const parsed = parseGpRoutes(typeof raw.routes === "string" ? raw.routes : "");
    if (!parsed) return fail("routesInvalid");
    const routes = parsed.length > 0 ? formatGpRoutes(parsed) : null;
    if (current) {
      db.update(vpns).set({ name, gateway, routes }).where(eq(vpns.id, current.id)).run();
      return { id: current.id };
    }
    const sudoSlug = vpnSlug(name);
    // It names a script and a sudo rule, which two VPNs cannot share.
    if (db.select({ id: vpns.id }).from(vpns).where(eq(vpns.sudoSlug, sudoSlug)).get()) return fail("nameTaken");
    return { id: db.insert(vpns).values({ name, gateway, routes, kind: "globalprotect", sudoSlug }).returning({ id: vpns.id }).get().id };
  }

  const username = text(raw.username);
  const common = { name, username, passwordSecret, tokenAppended: raw.tokenAppended === true };
  if (username && !isVpnUsername(username)) return fail("usernameInvalid");
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
  const logFile = sudoLogFile(slugOf(row));
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

/**
 * The Microsoft login shows in a window of `gp-saml-gui`, on this desktop: the person types the
 * password and the code there. Its cookie goes to openconnect once, on its input; a refusal ends it.
 */
async function connectGlobalProtect(
  db: Db,
  row: Row,
  run: CommandRunner,
  gp: GpDriver,
  now: () => number,
  pause: (ms: number) => Promise<void>,
): Promise<{ ok: true } | VpnFailure> {
  const slug = slugOf(row);
  if (await gp.alive(slug)) {
    if (readGpLog(await gp.readLog(slug)) === "connected") return { ok: true };
    await gp.stop(slug);
  }
  // Checked before the login: a code typed for nothing would be lost.
  if (!sudoRuleAllows((await run("sudo", ["-n", "-l"])).stdout, gpRuleCommand(slug))) return fail("sudoRuleMissing");
  const saml = await run("gp-saml-gui", gpSamlArguments(row.gateway ?? ""), undefined, SAML_TIMEOUT_MS);
  if (saml.notInstalled) return fail("gpSamlMissing");
  if (saml.code === null) return fail("timeout");
  const login = saml.code === 0 ? parseGpSaml(saml.stdout) : null;
  if (!login) return fail("samlFailed", lastLine(withoutCookies(saml.stderr)));
  db.update(vpns).set({ username: login.user }).where(eq(vpns.id, row.id)).run();
  await gp.launch(sudoGpCommand(slug), `${login.user}\n${login.group}\n${login.cookie}`, slug);
  const deadline = now() + CONNECT_WAIT_SECONDS * 1000;
  while (now() < deadline) {
    const log = await gp.readLog(slug);
    const end = readGpLog(log);
    if (end === "refused") {
      await gp.stop(slug);
      return fail("authRefused");
    }
    if (end === "ruleMissing") return fail("sudoRuleMissing");
    if (end === "connected") return { ok: true };
    if (end === "ended" || !(await gp.alive(slug))) return fail("connectFailed", lastLine(log, login.cookie));
    await pause(WATCH_MS);
  }
  await gp.stop(slug);
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
  gp: GpDriver = realGpDriver,
): Promise<{ ok: true } | VpnFailure> {
  const row = db.select().from(vpns).where(eq(vpns.id, id)).get();
  if (!row) return fail("gone");
  if (row.kind === "globalprotect") return connectGlobalProtect(db, row, run, gp, now, pause);
  if (row.kind === "wireguard") {
    // Its keys are in the profile: nothing to type, nor any password to blame.
    const ran = await run("nmcli", nmUpArguments(row.connectionUuid ?? "", CONNECT_WAIT_SECONDS), undefined, CONNECT_TIMEOUT_MS);
    if (ran.notInstalled) return fail("nmcliMissing");
    if (ran.code === null) return fail("timeout");
    return ran.code === 0 ? { ok: true } : fail("tunnelFailed", lastLine(ran.stderr || ran.stdout));
  }
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

export async function disconnectVpn(db: Db, id: number, run: CommandRunner = runCommand, driver: SudoDriver = realSudoDriver, gp: GpDriver = realGpDriver): Promise<VpnFailure | null> {
  const row = db.select().from(vpns).where(eq(vpns.id, id)).get();
  if (!row) return fail("gone");
  if (row.kind === "globalprotect") return (await gp.stop(slugOf(row))) ? null : fail("disconnectFailed");
  if (row.kind === "sudo_openvpn") return (await driver.stop(pathsOf(row, driver.uid).socket)) ? null : fail("disconnectFailed");
  const ran = row.kind === "nordlayer" ? await run("nordlayer", ["--assume-yes", "disconnect"]) : await run("nmcli", nmDownArguments(row.connectionUuid ?? ""));
  if (ran.notInstalled) return fail(row.kind === "nordlayer" ? "nordlayerMissing" : "nmcliMissing");
  return ran.code === 0 ? null : fail("disconnectFailed", lastLine(ran.stderr || ran.stdout));
}

/** Its profile goes with it: left behind, it would stay in the system's settings with no way back here. */
export async function deleteVpn(db: Db, id: number, run: CommandRunner = runCommand, driver: SudoDriver = realSudoDriver, gp: GpDriver = realGpDriver): Promise<VpnFailure | null> {
  const row = db.select().from(vpns).where(eq(vpns.id, id)).get();
  if (!row) return null;
  if (row.kind === "globalprotect") await gp.stop(slugOf(row));
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
