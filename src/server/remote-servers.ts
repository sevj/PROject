import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { cleanLogText } from "@/lib/container-logs";
import {
  choosePod,
  isContainerName,
  isHost,
  isJumpHost,
  isKeyPath,
  isKubeContext,
  isKubeTarget,
  isNamespace,
  isPort,
  isRemotePath,
  isUsername,
  isWebUrl,
  isWorkload,
  kubeClusterArguments,
  kubePodsArguments,
  kubeWorkloadArguments,
  parsePods,
  parseSshAliases,
  privateKeysAmong,
  readKubeExit,
  readSshExit,
  type RunningPod,
  type SshAuth,
  sshArguments,
  sshProbe,
  type TestFailure,
  type TestResult,
  workloadSelector,
} from "@/lib/remote-servers";
import type { Db } from "./db/client";
import { environmentAccesses, type EnvironmentUrl, projectEnvironments, projects, projectMeta, remoteServers, vpns } from "./db/schema";
import { type CommandRunner, runCommand } from "./run-command";
import { decryptSecret, encryptSecret } from "./secrets";
import { downVpnName } from "./vpn";

export { type CommandRunner, runCommand } from "./run-command";

export type ServerKind = "ssh" | "kubernetes";

export type ServerInput = {
  name: string;
  kind: ServerKind;
  host: string | null;
  port: number | null;
  username: string | null;
  auth: SshAuth | null;
  keyPath: string | null;
  jumpHost: string | null;
  context: string | null;
  vpnId?: number | null;
};

/** What leaves the server. The password stays behind: only whether one is kept. */
export type ServerView = ServerInput & {
  id: number;
  hasPassword: boolean;
  usedBy: { projectId: number; projectName: string; environment: string }[];
};

export type EnvironmentInput = { name: string; protected: boolean; urls: EnvironmentUrl[]; notes: string | null };

export type AccessInput = {
  serverId: number;
  label: string;
  path: string | null;
  namespace: string | null;
  target: string | null;
  container: string | null;
};

export type AccessView = AccessInput & { id: number; serverName: string; serverKind: ServerKind; serverAuth: SshAuth | null; serverHasPassword: boolean };
export type EnvironmentView = EnvironmentInput & { id: number; accesses: AccessView[] };

export type Problem =
  | "nameMissing"
  | "nameTaken"
  | "hostInvalid"
  | "portInvalid"
  | "usernameInvalid"
  | "authInvalid"
  | "keyInvalid"
  | "jumpInvalid"
  | "contextInvalid"
  | "serverInUse"
  | "serverMissing"
  | "urlInvalid"
  | "pathInvalid"
  | "namespaceInvalid"
  | "targetInvalid"
  | "containerInvalid"
  | "environmentMissing"
  | "accessMissing"
  | "projectMissing"
  | "vpnMissing";

export type Saved = { id: number } | { problem: Problem };

const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** Everything that comes from a form is checked here, since it ends up on a command line. */
function readServerInput(raw: ServerInput): ServerInput | Problem {
  const name = text(raw.name);
  if (!name) return "nameMissing";
  const empty = { host: null, port: null, username: null, auth: null, keyPath: null, jumpHost: null, context: null };
  if (raw.kind === "kubernetes") {
    const context = text(raw.context);
    if (!context || !isKubeContext(context)) return "contextInvalid";
    return { ...empty, name, kind: "kubernetes", context };
  }
  if (raw.kind !== "ssh") return "authInvalid";
  const host = text(raw.host);
  if (!host || !isHost(host)) return "hostInvalid";
  const auth = raw.auth;
  if (auth !== "alias" && auth !== "agent" && auth !== "key" && auth !== "password") return "authInvalid";
  // An alias says all of this in ~/.ssh/config.
  if (auth === "alias") return { ...empty, name, kind: "ssh", host, auth };
  const username = text(raw.username);
  if (username && !isUsername(username)) return "usernameInvalid";
  if (raw.port !== null && !isPort(raw.port)) return "portInvalid";
  const jumpHost = text(raw.jumpHost);
  if (jumpHost && !isJumpHost(jumpHost)) return "jumpInvalid";
  const keyPath = auth === "key" ? text(raw.keyPath) : null;
  if (auth === "key" && (!keyPath || !isKeyPath(keyPath))) return "keyInvalid";
  return { ...empty, name, kind: "ssh", host, port: raw.port, username, auth, keyPath, jumpHost };
}

const displayName = (db: Db, projectId: number) => {
  const meta = db.select({ name: projectMeta.displayName }).from(projectMeta).where(eq(projectMeta.projectId, projectId)).get();
  return meta?.name ?? db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).get()?.name ?? "";
};

export function listServers(db: Db): ServerView[] {
  const usage = db
    .select({ serverId: environmentAccesses.serverId, projectId: projectEnvironments.projectId, environment: projectEnvironments.name })
    .from(environmentAccesses)
    .innerJoin(projectEnvironments, eq(environmentAccesses.environmentId, projectEnvironments.id))
    .all();
  return db
    .select()
    .from(remoteServers)
    .all()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((server) => {
      const seen = new Set<string>();
      return {
        // Field by field, so that the secret, or one added later, cannot leave by accident.
        id: server.id,
        name: server.name,
        kind: server.kind,
        host: server.host,
        port: server.port,
        username: server.username,
        auth: server.auth,
        keyPath: server.keyPath,
        jumpHost: server.jumpHost,
        context: server.context,
        vpnId: server.vpnId,
        hasPassword: server.passwordSecret !== null,
        usedBy: usage
          .filter(({ serverId, projectId, environment }) => {
            const key = `${projectId}/${environment}`;
            if (serverId !== server.id || seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map(({ projectId, environment }) => ({ projectId, environment, projectName: displayName(db, projectId) })),
      };
    });
}

export function saveServer(db: Db, id: number | null, raw: ServerInput): Saved {
  const input = readServerInput(raw);
  if (typeof input === "string") return { problem: input };
  const vpnId = raw.vpnId ?? null;
  if (vpnId !== null && !db.select({ id: vpns.id }).from(vpns).where(eq(vpns.id, vpnId)).get()) return { problem: "vpnMissing" };
  input.vpnId = vpnId;
  const taken = db.select({ id: remoteServers.id }).from(remoteServers).where(eq(remoteServers.name, input.name)).get();
  if (taken && taken.id !== id) return { problem: "nameTaken" };
  if (id === null) return { id: db.insert(remoteServers).values(input).returning({ id: remoteServers.id }).get().id };
  const current = db.select().from(remoteServers).where(eq(remoteServers.id, id)).get();
  if (!current) return { problem: "serverMissing" };
  // A kept password must not follow to another machine or account, where the next test would send it.
  const samePlace = current.host === input.host && current.username === input.username && input.auth === "password";
  db.update(remoteServers)
    .set({ ...input, passwordSecret: samePlace ? current.passwordSecret : null })
    .where(eq(remoteServers.id, id))
    .run();
  return { id };
}

export function deleteServer(db: Db, id: number): Problem | null {
  const used = db.select({ id: environmentAccesses.id }).from(environmentAccesses).where(eq(environmentAccesses.serverId, id)).get();
  if (used) return "serverInUse";
  db.delete(remoteServers).where(eq(remoteServers.id, id)).run();
  return null;
}

/** Kept as given, spaces included, and without trying it: the server may be out of reach for now. */
export function keepPassword(db: Db, id: number, password: string): boolean {
  const server = db.select({ auth: remoteServers.auth }).from(remoteServers).where(eq(remoteServers.id, id)).get();
  if (server?.auth !== "password" || password === "" || password.includes("\n")) return false;
  db.update(remoteServers).set({ passwordSecret: encryptSecret(password) }).where(eq(remoteServers.id, id)).run();
  return true;
}

export function forgetPassword(db: Db, id: number): void {
  db.update(remoteServers).set({ passwordSecret: null }).where(eq(remoteServers.id, id)).run();
}

export function listEnvironments(db: Db, projectId: number): EnvironmentView[] {
  const accesses = db
    .select({ access: environmentAccesses, server: remoteServers })
    .from(environmentAccesses)
    .innerJoin(projectEnvironments, eq(environmentAccesses.environmentId, projectEnvironments.id))
    .innerJoin(remoteServers, eq(environmentAccesses.serverId, remoteServers.id))
    .where(eq(projectEnvironments.projectId, projectId))
    .orderBy(environmentAccesses.id)
    .all();
  return db
    .select()
    .from(projectEnvironments)
    .where(eq(projectEnvironments.projectId, projectId))
    .orderBy(projectEnvironments.id)
    .all()
    .map(({ id, name, protected: isProtected, urls, notes }) => ({
      id,
      name,
      protected: isProtected,
      urls,
      notes,
      accesses: accesses
        .filter(({ access }) => access.environmentId === id)
        .map(({ access, server }) => ({
          id: access.id,
          serverId: access.serverId,
          label: access.label,
          path: access.path,
          namespace: access.namespace,
          target: access.target,
          container: access.container,
          serverName: server.name,
          serverKind: server.kind,
          serverAuth: server.auth,
          serverHasPassword: server.passwordSecret !== null,
        })),
    }));
}

export function saveEnvironment(db: Db, projectId: number, id: number | null, raw: EnvironmentInput): Saved {
  const name = text(raw.name);
  if (!name) return { problem: "nameMissing" };
  if (!db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) return { problem: "projectMissing" };
  const urls = (Array.isArray(raw.urls) ? raw.urls : [])
    .map(({ label, url }) => ({ label: text(label) ?? "", url: text(url) ?? "" }))
    .filter(({ label, url }) => label !== "" || url !== "");
  if (urls.some(({ url }) => !isWebUrl(url))) return { problem: "urlInvalid" };
  const values = { name, protected: raw.protected === true, urls, notes: text(raw.notes) };
  const taken = db
    .select({ id: projectEnvironments.id })
    .from(projectEnvironments)
    .where(and(eq(projectEnvironments.projectId, projectId), eq(projectEnvironments.name, name)))
    .get();
  if (taken && taken.id !== id) return { problem: "nameTaken" };
  if (id === null) return { id: db.insert(projectEnvironments).values({ ...values, projectId }).returning({ id: projectEnvironments.id }).get().id };
  const owned = and(eq(projectEnvironments.id, id), eq(projectEnvironments.projectId, projectId));
  if (!db.select({ id: projectEnvironments.id }).from(projectEnvironments).where(owned).get()) return { problem: "environmentMissing" };
  db.update(projectEnvironments).set(values).where(owned).run();
  return { id };
}

export function deleteEnvironment(db: Db, projectId: number, id: number): void {
  db.delete(projectEnvironments).where(and(eq(projectEnvironments.id, id), eq(projectEnvironments.projectId, projectId))).run();
}

function readAccessInput(db: Db, raw: AccessInput): AccessInput | Problem {
  const label = text(raw.label);
  if (!label) return "nameMissing";
  const server = Number.isInteger(raw.serverId) ? db.select().from(remoteServers).where(eq(remoteServers.id, raw.serverId)).get() : null;
  if (!server) return "serverMissing";
  const empty = { path: null, namespace: null, target: null, container: null };
  if (server.kind === "ssh") {
    const path = text(raw.path);
    if (path && !isRemotePath(path)) return "pathInvalid";
    return { ...empty, serverId: server.id, label, path };
  }
  const namespace = text(raw.namespace);
  if (namespace && !isNamespace(namespace)) return "namespaceInvalid";
  const target = text(raw.target);
  if (target && !isKubeTarget(target)) return "targetInvalid";
  const container = text(raw.container);
  if (container && (!isContainerName(container) || !target)) return "containerInvalid";
  return { ...empty, serverId: server.id, label, namespace, target, container };
}

/** Always within one project, so that a stale page cannot reach an access of another one. */
function ownedEnvironment(db: Db, projectId: number, environmentId: number) {
  return db
    .select({ id: projectEnvironments.id })
    .from(projectEnvironments)
    .where(and(eq(projectEnvironments.id, environmentId), eq(projectEnvironments.projectId, projectId)))
    .get();
}

export function saveAccess(db: Db, projectId: number, environmentId: number, id: number | null, raw: AccessInput): Saved {
  if (!ownedEnvironment(db, projectId, environmentId)) return { problem: "environmentMissing" };
  const input = readAccessInput(db, raw);
  if (typeof input === "string") return { problem: input };
  if (id === null) return { id: db.insert(environmentAccesses).values({ ...input, environmentId }).returning({ id: environmentAccesses.id }).get().id };
  const owned = and(eq(environmentAccesses.id, id), eq(environmentAccesses.environmentId, environmentId));
  if (!db.select({ id: environmentAccesses.id }).from(environmentAccesses).where(owned).get()) return { problem: "accessMissing" };
  db.update(environmentAccesses).set(input).where(owned).run();
  return { id };
}

export function deleteAccess(db: Db, projectId: number, environmentId: number, id: number): void {
  if (!ownedEnvironment(db, projectId, environmentId)) return;
  db.delete(environmentAccesses).where(and(eq(environmentAccesses.id, id), eq(environmentAccesses.environmentId, environmentId))).run();
}

export type Suggestions = { aliases: string[]; keys: string[]; contexts: string[] };

export async function readSuggestions(run: CommandRunner = runCommand, home = homedir()): Promise<Suggestions> {
  const sshDir = join(home, ".ssh");
  const [config, files, contexts] = await Promise.all([
    readFile(join(sshDir, "config"), "utf8").catch(() => ""),
    readdir(sshDir).catch(() => [] as string[]),
    run("kubectl", ["config", "get-contexts", "-o", "name"]).catch(() => null),
  ]);
  return {
    aliases: parseSshAliases(config),
    keys: privateKeysAmong(files).map((name) => `~/.ssh/${name}`),
    contexts: contexts?.code === 0 ? contexts.stdout.split("\n").map((line) => line.trim()).filter(Boolean).sort() : [],
  };
}

/** The pod a console on this target enters, which a test has to look at too. */
export async function resolveKubePod(
  run: CommandRunner,
  context: string,
  namespace: string | null,
  target: string,
): Promise<{ pod: RunningPod } | { failure: TestFailure; detail: string }> {
  const lastLine = (text: string) => text.split(/\r?\n/).map(cleanLogText).filter(Boolean).at(-1)?.slice(0, 300) ?? "";
  const ask = async (args: string[]): Promise<{ stdout: string } | { failure: TestFailure; detail: string }> => {
    const ran = await run("kubectl", args);
    if (ran.notInstalled) return { failure: "kubectlMissing", detail: "" };
    const failure = readKubeExit(ran.code, ran.stderr);
    return failure ? { failure, detail: lastLine(ran.stderr) } : { stdout: ran.stdout };
  };
  try {
    let selector = target;
    if (isWorkload(target)) {
      const workload = await ask(kubeWorkloadArguments(context, namespace, target));
      if ("failure" in workload) return workload;
      selector = workloadSelector(workload.stdout) ?? "";
    }
    const pods = await ask(kubePodsArguments(context, namespace, selector || null));
    if ("failure" in pods) return pods;
    const chosen = choosePod(parsePods(pods.stdout), target);
    return "pod" in chosen ? chosen : { detail: "", ...chosen };
  } catch (error) {
    // Not the JSON it should be.
    return { failure: "unknown", detail: error instanceof Error ? error.message.slice(0, 300) : "" };
  }
}

export type TestRequest = { serverId: number; accessId?: number; password?: string; remember?: boolean };

const failed = (failure: TestFailure, stderr: string, password?: string): TestResult => {
  const last = stderr.split(/\r?\n/).map(cleanLogText).filter(Boolean).at(-1) ?? "";
  // Nothing prints it today, and it must stay so whatever a remote banner or a tool does.
  const detail = password ? last.replaceAll(password, "***") : last;
  return { ok: false, failure, detail: detail.slice(0, 300) };
};

/** A connection, on request only, that runs nothing but a look. A password is only kept once it has worked. */
export async function testConnection(db: Db, request: TestRequest, run: CommandRunner = runCommand, home = homedir()): Promise<TestResult> {
  const server = db.select().from(remoteServers).where(eq(remoteServers.id, request.serverId)).get();
  if (!server) return { ok: false, failure: "gone", detail: "" };
  let access = null;
  if (request.accessId !== undefined) {
    access = db
      .select()
      .from(environmentAccesses)
      .where(and(eq(environmentAccesses.id, request.accessId), eq(environmentAccesses.serverId, server.id)))
      .get();
    if (!access) return { ok: false, failure: "gone", detail: "" };
  }
  // Without it the server only times out, which says nothing.
  const down = await downVpnName(db, server.vpnId, run);
  if (down) return { ok: false, failure: "vpnDown", detail: down };

  if (server.kind === "kubernetes") {
    const context = server.context ?? "";
    if (access?.target) {
      const resolved = await resolveKubePod(run, context, access.namespace, access.target);
      if ("failure" in resolved) return { ok: false, ...resolved };
      if (access.container && !resolved.pod.containers.includes(access.container)) {
        return { ok: false, failure: "containerMissing", detail: resolved.pod.containers.join(", ") };
      }
      return { ok: true };
    }
    const ran = await run("kubectl", kubeClusterArguments(context));
    if (ran.notInstalled) return { ok: false, failure: "kubectlMissing", detail: "" };
    const failure = readKubeExit(ran.code, ran.stderr);
    return failure ? failed(failure, ran.stderr) : { ok: true };
  }

  const auth = server.auth ?? "agent";
  const target = { host: server.host ?? "", port: server.port, username: server.username, auth, keyPath: server.keyPath, jumpHost: server.jumpHost };
  const path = access?.path ?? null;
  const args = sshArguments(target, sshProbe(path), home);

  if (auth !== "password") {
    const ran = await run("ssh", args);
    if (ran.notInstalled) return { ok: false, failure: "sshMissing", detail: "" };
    const failure = readSshExit(ran.code, ran.stderr, false, path !== null);
    return failure ? failed(failure, ran.stderr) : { ok: true };
  }

  const given = request.password ? request.password : undefined;
  const password = given ?? (server.passwordSecret ? (decryptSecret(server.passwordSecret) ?? undefined) : undefined);
  if (!password) return { ok: false, failure: "passwordNeeded", detail: "" };
  const ran = await run("sshpass", ["-d", "3", "ssh", ...args], password);
  if (ran.notInstalled) return { ok: false, failure: "sshpassMissing", detail: "" };
  const failure = readSshExit(ran.code, ran.stderr, true, path !== null);
  if (failure) return failed(failure, ran.stderr, password);
  if (given && request.remember === true) {
    db.update(remoteServers).set({ passwordSecret: encryptSecret(given) }).where(eq(remoteServers.id, server.id)).run();
  }
  return { ok: true };
}
