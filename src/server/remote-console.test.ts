import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "./db/client";
import { environmentAccesses, projectEnvironments, projects, remoteServers } from "./db/schema";
import { prepareRemoteConsole } from "./remote-console";
import type { CommandRunner } from "./remote-servers";
import { encryptSecret } from "./secrets";

let db: Db;
let keyDir: string;
let projectId: number;
let environmentId: number;

const works = vi.fn<CommandRunner>(async () => ({ code: 0, stdout: "", stderr: "", notInstalled: false }));
const answering = (stdout: string, code = 0, stderr = "") => vi.fn<CommandRunner>(async () => ({ code, stdout, stderr, notInstalled: false }));

const pod = (name: string, replicaSet: string, hash: string) => ({ metadata: { name, labels: { "pod-template-hash": hash }, ownerReferences: [{ kind: "ReplicaSet", name: replicaSet, controller: true }] } });
const own = pod("api-1-x", "api-1", "1");
const rabbit = pod("api-rabbitmq-2-y", "api-rabbitmq-2", "2");
const cluster = (items: object[]) =>
  vi.fn<CommandRunner>(async (_command, args) => ({ code: 0, stderr: "", notInstalled: false, stdout: JSON.stringify(args.includes("pods") ? { items } : { spec: { selector: { matchLabels: { app: "api" } } } }) }));

const server = (values: Partial<typeof remoteServers.$inferInsert>) =>
  db.insert(remoteServers).values({ name: `s${Math.random()}`, kind: "ssh", host: "srv1", auth: "agent", ...values }).returning({ id: remoteServers.id }).get().id;
const access = (serverId: number, values: Partial<typeof environmentAccesses.$inferInsert> = {}) =>
  db.insert(environmentAccesses).values({ environmentId, serverId, label: "Web", ...values }).returning({ id: environmentAccesses.id }).get().id;

beforeAll(() => {
  keyDir = mkdtempSync(join(tmpdir(), "pm-console-key-"));
  process.env.PM_SECRET_KEY_PATH = join(keyDir, "secret.key");
});
afterAll(() => {
  delete process.env.PM_SECRET_KEY_PATH;
  rmSync(keyDir, { recursive: true, force: true });
});
beforeEach(() => {
  db = openDb(":memory:");
  projectId = db.insert(projects).values({ path: "/p", name: "p" }).returning({ id: projects.id }).get().id;
  environmentId = db.insert(projectEnvironments).values({ projectId, name: "Recette" }).returning({ id: projectEnvironments.id }).get().id;
});

describe("prepareRemoteConsole", () => {
  it("opens ssh in the folder of the access", async () => {
    const id = access(server({ username: "deploy" }), { path: "/srv/app" });
    const command = await prepareRemoteConsole(db, projectId, id, false, works, "/h");
    expect(command).toMatchObject({ program: "ssh" });
    expect("args" in command && command.args.at(-1)).toContain("cd '/srv/app'");
    expect("password" in command).toBe(false);
  });

  it("asks for a confirmation on a protected environment, and only there", async () => {
    const id = access(server({}));
    db.update(projectEnvironments).set({ protected: true }).where(eq(projectEnvironments.id, environmentId)).run();
    const run = vi.fn(works);
    expect(await prepareRemoteConsole(db, projectId, id, false, run, "/h")).toMatchObject({ failure: "notConfirmed" });
    expect(run).not.toHaveBeenCalled();
    expect(await prepareRemoteConsole(db, projectId, id, true, works, "/h")).toMatchObject({ program: "ssh" });
  });

  it("does not reach the access of another project, or of an abandoned one", async () => {
    const id = access(server({}));
    const other = db.insert(projects).values({ path: "/q", name: "q" }).returning({ id: projects.id }).get().id;
    expect(await prepareRemoteConsole(db, other, id, true, works, "/h")).toMatchObject({ failure: "gone" });
    db.update(projects).set({ abandoned: true }).where(eq(projects.id, projectId)).run();
    expect(await prepareRemoteConsole(db, projectId, id, true, works, "/h")).toMatchObject({ failure: "gone" });
  });

  it("lets ssh ask when no password is kept, and uses a kept one", async () => {
    const asked = await prepareRemoteConsole(db, projectId, access(server({ auth: "password" })), false, works, "/h");
    expect("password" in asked).toBe(false);
    const kept = await prepareRemoteConsole(db, projectId, access(server({ auth: "password", passwordSecret: encryptSecret("hunter2") })), false, works, "/h");
    expect(kept).toMatchObject({ program: "ssh", password: "hunter2" });
    expect("args" in kept && kept.args.join(" ")).not.toContain("hunter2");
  });

  it("falls back on typing it when a kept password is unreadable or sshpass is missing", async () => {
    const broken = await prepareRemoteConsole(db, projectId, access(server({ auth: "password", passwordSecret: "v1:broken" })), false, works, "/h");
    expect("password" in broken).toBe(false);
    const noSshpass = vi.fn<CommandRunner>(async (command) => ({ code: 0, stdout: "", stderr: "", notInstalled: command === "sshpass" }));
    const without = await prepareRemoteConsole(db, projectId, access(server({ auth: "password", passwordSecret: encryptSecret("x") })), false, noSshpass, "/h");
    expect("password" in without).toBe(false);
  });

  it("enters the pod a deployment owns, not another its selector matches", async () => {
    const id = access(server({ kind: "kubernetes", context: "prod" }), { namespace: "ns", target: "deployment/api", container: "php" });
    const command = await prepareRemoteConsole(db, projectId, id, false, cluster([rabbit, own]), "/h");
    expect(command).toMatchObject({ program: "kubectl" });
    expect("args" in command && command.args.slice(0, 6)).toEqual(["--context=prod", "--namespace=ns", "exec", "-it", "pod/api-1-x", "--container=php"]);
  });

  it("does not open when the deployment has no pod of its own", async () => {
    const id = access(server({ kind: "kubernetes", context: "c" }), { target: "deployment/api" });
    expect(await prepareRemoteConsole(db, projectId, id, false, cluster([rabbit]), "/h")).toMatchObject({ failure: "noRunningPod" });
  });

  it("finds a running pod for labels, and refuses to choose between workloads", async () => {
    const id = access(server({ kind: "kubernetes", context: "c" }), { target: "app=api" });
    const command = await prepareRemoteConsole(db, projectId, id, false, cluster([own]), "/h");
    expect("args" in command && command.args).toContain("pod/api-1-x");
    expect(await prepareRemoteConsole(db, projectId, id, false, cluster([]), "/h")).toMatchObject({ failure: "noRunningPod" });
    expect(await prepareRemoteConsole(db, projectId, id, false, cluster([own, rabbit]), "/h")).toMatchObject({ failure: "ambiguousTarget" });
    expect(await prepareRemoteConsole(db, projectId, id, false, answering("", 1, "Unable to connect to the server"), "/h")).toMatchObject({ failure: "unreachable" });
  });

  it("needs a target to enter", async () => {
    const id = access(server({ kind: "kubernetes", context: "c" }));
    expect(await prepareRemoteConsole(db, projectId, id, false, works, "/h")).toMatchObject({ failure: "noTarget" });
  });

  it("says when a tool is missing", async () => {
    const missing = vi.fn<CommandRunner>(async () => ({ code: 127, stdout: "", stderr: "", notInstalled: true }));
    expect(await prepareRemoteConsole(db, projectId, access(server({})), false, missing, "/h")).toMatchObject({ failure: "sshMissing" });
    expect(await prepareRemoteConsole(db, projectId, access(server({ kind: "kubernetes", context: "c" }), { target: "deployment/a" }), false, missing, "/h")).toMatchObject({ failure: "kubectlMissing" });
  });
});
