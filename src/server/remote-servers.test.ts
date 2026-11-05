import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "./db/client";
import { projects, remoteServers } from "./db/schema";
import {
  deleteAccess,
  deleteEnvironment,
  deleteServer,
  forgetPassword,
  keepPassword,
  listEnvironments,
  listServers,
  type CommandRunner,
  saveAccess,
  saveEnvironment,
  saveServer,
  type ServerInput,
  testConnection,
} from "./remote-servers";

const ssh: ServerInput = { name: "web", kind: "ssh", host: "srv1", port: 22, username: "deploy", auth: "agent", keyPath: null, jumpHost: null, context: null };
const kube: ServerInput = { name: "cluster", kind: "kubernetes", host: null, port: null, username: null, auth: null, keyPath: null, jumpHost: null, context: "prod-ctx" };
const access = { label: "Web", path: null, namespace: null, target: null, container: null };

const answer = (code: number | null, stderr = "", stdout = "", notInstalled = false) =>
  vi.fn<CommandRunner>(async () => ({ code, stderr, stdout, notInstalled }));

const idOf = (saved: { id: number } | { problem: string }) => {
  if ("problem" in saved) throw new Error(saved.problem);
  return saved.id;
};

/** Answers as kubectl does: the workload first, then its pods. */
const cluster = (podItems: object[], selectorLabels: Record<string, string> = { app: "api" }) =>
  vi.fn<CommandRunner>(async (_command, args) => ({
    code: 0,
    stderr: "",
    notInstalled: false,
    stdout: JSON.stringify(args.includes("pods") ? { items: podItems } : { spec: { selector: { matchLabels: selectorLabels } } }),
  }));
const ownPod = { metadata: { name: "api-1-x", labels: { "pod-template-hash": "1" }, ownerReferences: [{ kind: "ReplicaSet", name: "api-1", controller: true }] }, spec: { containers: [{ name: "nginx" }, { name: "php" }] } };
const otherPod = { metadata: { name: "api-bdd-2-y", labels: { "pod-template-hash": "2" }, ownerReferences: [{ kind: "ReplicaSet", name: "api-bdd-2", controller: true }] }, spec: { containers: [{ name: "db" }] } };

let db: Db;
let projectId: number;
let keyDir: string;

beforeAll(() => {
  keyDir = mkdtempSync(join(tmpdir(), "pm-remote-"));
  process.env.PM_SECRET_KEY_PATH = join(keyDir, "secret.key");
});
afterAll(() => {
  delete process.env.PM_SECRET_KEY_PATH;
  rmSync(keyDir, { recursive: true, force: true });
});
beforeEach(() => {
  db = openDb(":memory:");
  projectId = db.insert(projects).values({ path: "/p", name: "p" }).returning({ id: projects.id }).get().id;
});

describe("servers", () => {
  it("refuses what could reach a command line unchecked", () => {
    expect(saveServer(db, null, { ...ssh, host: "-oProxyCommand=x" })).toEqual({ problem: "hostInvalid" });
    expect(saveServer(db, null, { ...ssh, username: "a b" })).toEqual({ problem: "usernameInvalid" });
    expect(saveServer(db, null, { ...ssh, port: 70000 })).toEqual({ problem: "portInvalid" });
    expect(saveServer(db, null, { ...ssh, jumpHost: "a;b" })).toEqual({ problem: "jumpInvalid" });
    expect(saveServer(db, null, { ...ssh, auth: "key" })).toEqual({ problem: "keyInvalid" });
    expect(saveServer(db, null, { ...kube, context: "a b" })).toEqual({ problem: "contextInvalid" });
    expect(saveServer(db, null, { ...ssh, name: " " })).toEqual({ problem: "nameMissing" });
  });

  it("keeps names unique, and drops what the kind does not use", () => {
    idOf(saveServer(db, null, ssh));
    expect(saveServer(db, null, ssh)).toEqual({ problem: "nameTaken" });
    idOf(saveServer(db, null, { ...ssh, name: "alias", auth: "alias", username: "ignored" }));
    expect(listServers(db).find(({ name }) => name === "alias")?.username).toBeNull();
  });

  it("never lets a stored password out, only that there is one", () => {
    const id = idOf(saveServer(db, null, { ...ssh, auth: "password" }));
    db.update(remoteServers).set({ passwordSecret: "v1:secret" }).where(eq(remoteServers.id, id)).run();
    const [view] = listServers(db);
    expect(view.hasPassword).toBe(true);
    expect(JSON.stringify(view)).not.toContain("v1:secret");
    forgetPassword(db, id);
    expect(listServers(db)[0].hasPassword).toBe(false);
  });

  it("does not let a kept password follow to another machine or account", () => {
    const id = idOf(saveServer(db, null, { ...ssh, auth: "password" }));
    const keep = () => db.update(remoteServers).set({ passwordSecret: "v1:x" }).where(eq(remoteServers.id, id)).run();
    keep();
    idOf(saveServer(db, id, { ...ssh, auth: "password", name: "renamed" }));
    expect(listServers(db)[0].hasPassword).toBe(true);
    idOf(saveServer(db, id, { ...ssh, auth: "password", host: "evil" }));
    expect(listServers(db)[0].hasPassword).toBe(false);
    keep();
    idOf(saveServer(db, id, { ...ssh, auth: "password", username: "other" }));
    expect(listServers(db)[0].hasPassword).toBe(false);
    keep();
    idOf(saveServer(db, id, ssh));
    expect(listServers(db)[0].hasPassword).toBe(false);
  });

  it("keeps a password given in the form, encrypted, and uses it", async () => {
    const id = idOf(saveServer(db, null, { ...ssh, auth: "password" }));
    expect(keepPassword(db, id, " hunter2 ")).toBe(true);
    const stored = db.select().from(remoteServers).where(eq(remoteServers.id, id)).get()?.passwordSecret;
    expect(stored).not.toContain("hunter2");
    const run = answer(0);
    await testConnection(db, { serverId: id }, run, "/h");
    expect(run.mock.calls[0][2]).toBe(" hunter2 ");
  });

  it("keeps no password for a server that does not use one, nor an empty one", () => {
    const agent = idOf(saveServer(db, null, ssh));
    expect(keepPassword(db, agent, "x")).toBe(false);
    const id = idOf(saveServer(db, null, { ...ssh, name: "p", auth: "password" }));
    expect(keepPassword(db, id, "")).toBe(false);
    expect(keepPassword(db, id, "a\nb")).toBe(false);
    expect(listServers(db).every(({ hasPassword }) => !hasPassword)).toBe(true);
  });

  it("cannot delete a server still in use", () => {
    const serverId = idOf(saveServer(db, null, ssh));
    const environmentId = idOf(saveEnvironment(db, projectId, null, { name: "Prod", protected: true, urls: [], notes: null }));
    const accessId = idOf(saveAccess(db, projectId, environmentId, null, { ...access, serverId }));
    expect(listServers(db)[0].usedBy).toEqual([{ projectId, projectName: "p", environment: "Prod" }]);
    expect(deleteServer(db, serverId)).toBe("serverInUse");
    deleteAccess(db, projectId, environmentId, accessId);
    expect(deleteServer(db, serverId)).toBeNull();
    expect(listServers(db)).toEqual([]);
  });
});

describe("environments", () => {
  it("holds several per project, each name once", () => {
    idOf(saveEnvironment(db, projectId, null, { name: "Recette", protected: false, urls: [], notes: null }));
    idOf(saveEnvironment(db, projectId, null, { name: "Prod", protected: true, urls: [{ label: "Site", url: "https://x.fr" }], notes: " VPN " }));
    expect(saveEnvironment(db, projectId, null, { name: "Prod", protected: false, urls: [], notes: null })).toEqual({ problem: "nameTaken" });
    const views = listEnvironments(db, projectId);
    expect(views.map(({ name }) => name)).toEqual(["Recette", "Prod"]);
    expect(views[1]).toMatchObject({ protected: true, urls: [{ label: "Site", url: "https://x.fr" }], notes: "VPN" });
  });

  it("refuses an address a link could run, and drops empty lines", () => {
    const input = { name: "A", protected: false, notes: null };
    expect(saveEnvironment(db, projectId, null, { ...input, urls: [{ label: "x", url: "javascript:alert(1)" }] })).toEqual({ problem: "urlInvalid" });
    const id = idOf(saveEnvironment(db, projectId, null, { ...input, urls: [{ label: " ", url: " " }] }));
    expect(listEnvironments(db, projectId).find((view) => view.id === id)?.urls).toEqual([]);
  });

  it("does not reach another project's environment", () => {
    const other = db.insert(projects).values({ path: "/q", name: "q" }).returning({ id: projects.id }).get().id;
    const id = idOf(saveEnvironment(db, projectId, null, { name: "A", protected: false, urls: [], notes: null }));
    expect(saveEnvironment(db, other, id, { name: "B", protected: false, urls: [], notes: null })).toEqual({ problem: "environmentMissing" });
    const serverId = idOf(saveServer(db, null, ssh));
    expect(saveAccess(db, other, id, null, { ...access, serverId })).toEqual({ problem: "environmentMissing" });
    deleteEnvironment(db, other, id);
    expect(listEnvironments(db, projectId)).toHaveLength(1);
  });

  it("checks an access against its kind of server", () => {
    const environmentId = idOf(saveEnvironment(db, projectId, null, { name: "A", protected: false, urls: [], notes: null }));
    const sshId = idOf(saveServer(db, null, ssh));
    const kubeId = idOf(saveServer(db, null, kube));
    expect(saveAccess(db, projectId, environmentId, null, { ...access, serverId: sshId, path: "relative" })).toEqual({ problem: "pathInvalid" });
    expect(saveAccess(db, projectId, environmentId, null, { ...access, serverId: kubeId, target: "pod/x" })).toEqual({ problem: "targetInvalid" });
    expect(saveAccess(db, projectId, environmentId, null, { ...access, serverId: kubeId, namespace: "-x" })).toEqual({ problem: "namespaceInvalid" });
    expect(saveAccess(db, projectId, environmentId, null, { ...access, serverId: kubeId, container: "php" })).toEqual({ problem: "containerInvalid" });
    expect(saveAccess(db, projectId, environmentId, null, { ...access, serverId: 999 })).toEqual({ problem: "serverMissing" });
    idOf(saveAccess(db, projectId, environmentId, null, { ...access, serverId: kubeId, namespace: "ns", target: "deployment/api", container: "php", path: "/ignored" }));
    expect(listEnvironments(db, projectId)[0].accesses[0]).toMatchObject({ serverName: "cluster", namespace: "ns", target: "deployment/api", container: "php", path: null });
  });

  it("goes away with its project, and leaves the server", () => {
    const serverId = idOf(saveServer(db, null, ssh));
    const environmentId = idOf(saveEnvironment(db, projectId, null, { name: "A", protected: false, urls: [], notes: null }));
    idOf(saveAccess(db, projectId, environmentId, null, { ...access, serverId }));
    db.delete(projects).where(eq(projects.id, projectId)).run();
    expect(listServers(db)[0].usedBy).toEqual([]);
  });
});

describe("testConnection", () => {
  it("looks at an SSH server without asking anything", async () => {
    const run = answer(0);
    const id = idOf(saveServer(db, null, ssh));
    expect(await testConnection(db, { serverId: id }, run, "/home/me")).toEqual({ ok: true });
    const [command, args, password] = run.mock.calls[0];
    expect(command).toBe("ssh");
    expect(args.slice(-3)).toEqual(["--", "srv1", "true"]);
    expect(args).toContain("BatchMode=yes");
    expect(password).toBeUndefined();
  });

  it("checks the folder of an access, and tells a missing one from a failed connection", async () => {
    const serverId = idOf(saveServer(db, null, ssh));
    const environmentId = idOf(saveEnvironment(db, projectId, null, { name: "A", protected: false, urls: [], notes: null }));
    const accessId = idOf(saveAccess(db, projectId, environmentId, null, { ...access, serverId, path: "/var/www" }));
    const run = answer(1);
    expect(await testConnection(db, { serverId, accessId }, run, "/h")).toMatchObject({ ok: false, failure: "folderMissing" });
    expect(run.mock.calls[0][1].at(-1)).toBe("test -d '/var/www'");
    expect(await testConnection(db, { serverId, accessId }, answer(255, "ssh: Connection refused"), "/h")).toMatchObject({ ok: false, failure: "unreachable" });
  });

  it("asks for a password rather than trying without", async () => {
    const run = answer(0);
    const id = idOf(saveServer(db, null, { ...ssh, auth: "password" }));
    expect(await testConnection(db, { serverId: id }, run, "/h")).toMatchObject({ ok: false, failure: "passwordNeeded" });
    expect(run).not.toHaveBeenCalled();
  });

  it("gives the password through a pipe, and never on the command line", async () => {
    const run = answer(0);
    const id = idOf(saveServer(db, null, { ...ssh, auth: "password" }));
    await testConnection(db, { serverId: id, password: "hunter2" }, run, "/h");
    const [command, args, password] = run.mock.calls[0];
    expect(command).toBe("sshpass");
    expect(args.slice(0, 3)).toEqual(["-d", "3", "ssh"]);
    expect(args.join(" ")).not.toContain("hunter2");
    expect(password).toBe("hunter2");
    expect(listServers(db)[0].hasPassword).toBe(false);
  });

  it("keeps a password only when asked and once it has worked, encrypted, and uses it next", async () => {
    const id = idOf(saveServer(db, null, { ...ssh, auth: "password" }));
    expect(await testConnection(db, { serverId: id, password: "bad", remember: true }, answer(5), "/h")).toMatchObject({ failure: "wrongPassword" });
    expect(listServers(db)[0].hasPassword).toBe(false);
    await testConnection(db, { serverId: id, password: "hunter2", remember: true }, answer(0), "/h");
    expect(listServers(db)[0].hasPassword).toBe(true);
    const stored = db.select().from(remoteServers).where(eq(remoteServers.id, id)).get()?.passwordSecret;
    expect(stored).not.toContain("hunter2");
    const run = answer(0);
    await testConnection(db, { serverId: id }, run, "/h");
    expect(run.mock.calls[0][2]).toBe("hunter2");
  });

  it("asks again when a kept password can no longer be read", async () => {
    const id = idOf(saveServer(db, null, { ...ssh, auth: "password" }));
    db.update(remoteServers).set({ passwordSecret: "v1:broken" }).where(eq(remoteServers.id, id)).run();
    expect(await testConnection(db, { serverId: id }, answer(0), "/h")).toMatchObject({ failure: "passwordNeeded" });
  });

  it("hides the password if anything ever prints it", async () => {
    const id = idOf(saveServer(db, null, { ...ssh, auth: "password" }));
    const result = await testConnection(db, { serverId: id, password: "hunter2" }, answer(255, "oops hunter2 here"), "/h");
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  it("says when a tool is missing", async () => {
    const id = idOf(saveServer(db, null, { ...ssh, auth: "password" }));
    expect(await testConnection(db, { serverId: id, password: "x" }, answer(127, "", "", true), "/h")).toMatchObject({ failure: "sshpassMissing" });
  });

  it("names its context on kubectl, and checks the target and its container", async () => {
    const serverId = idOf(saveServer(db, null, kube));
    const environmentId = idOf(saveEnvironment(db, projectId, null, { name: "A", protected: false, urls: [], notes: null }));
    const accessId = idOf(saveAccess(db, projectId, environmentId, null, { ...access, serverId, namespace: "ns", target: "deployment/api", container: "php" }));
    const version = answer(0);
    await testConnection(db, { serverId }, version, "/h");
    expect(version.mock.calls[0][1]).toContain("--context=prod-ctx");
    expect(version.mock.calls[0][1]).toContain("version");
    expect(await testConnection(db, { serverId, accessId }, cluster([otherPod, ownPod]), "/h")).toEqual({ ok: true });
    expect(await testConnection(db, { serverId, accessId }, answer(1, 'Error from server (NotFound): "api" not found'), "/h")).toMatchObject({ failure: "targetMissing" });
    expect(await testConnection(db, { serverId, accessId }, answer(0, "", "not json"), "/h")).toMatchObject({ failure: "unknown" });
  });

  it("looks at the pod a console would enter, not one the selector also matches", async () => {
    const serverId = idOf(saveServer(db, null, kube));
    const environmentId = idOf(saveEnvironment(db, projectId, null, { name: "A", protected: false, urls: [], notes: null }));
    const accessId = idOf(saveAccess(db, projectId, environmentId, null, { ...access, serverId, target: "deployment/api", container: "php" }));
    expect(await testConnection(db, { serverId, accessId }, cluster([otherPod]), "/h")).toMatchObject({ failure: "noRunningPod" });
    expect(await testConnection(db, { serverId, accessId }, cluster([{ ...ownPod, spec: { containers: [{ name: "nginx" }] } }]), "/h")).toMatchObject({ failure: "containerMissing", detail: "nginx" });
    const run = cluster([ownPod]);
    await testConnection(db, { serverId, accessId }, run, "/h");
    expect(run.mock.calls[1][1]).toContain("--selector=app=api");
  });

  it("refuses labels that span several workloads", async () => {
    const serverId = idOf(saveServer(db, null, kube));
    const environmentId = idOf(saveEnvironment(db, projectId, null, { name: "A", protected: false, urls: [], notes: null }));
    const accessId = idOf(saveAccess(db, projectId, environmentId, null, { ...access, serverId, target: "app=api" }));
    expect(await testConnection(db, { serverId, accessId }, cluster([ownPod, otherPod]), "/h")).toMatchObject({ failure: "ambiguousTarget", detail: "deployment/api, deployment/api-bdd" });
  });

  it("refuses an access that is not on this server", async () => {
    const serverId = idOf(saveServer(db, null, ssh));
    expect(await testConnection(db, { serverId, accessId: 999 }, answer(0), "/h")).toMatchObject({ failure: "gone" });
    expect(await testConnection(db, { serverId: 999 }, answer(0), "/h")).toMatchObject({ failure: "gone" });
  });
});
