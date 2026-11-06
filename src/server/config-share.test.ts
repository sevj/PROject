import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { eq } from "drizzle-orm";
import { exportConfig, exportProject, importConfig, importInto, importProject, readConfig } from "./config-share";
import { projectMeta } from "./db/schema";
import { getApmProjectId, setApmProjectId, setDescription } from "./classification";
import { type Db, openDb } from "./db/client";
import { environmentAccesses, httpRequests, httpVariables, projectEnvironments, projects, remoteServers, vpns } from "./db/schema";
import { saveRequest } from "./http-requests";
import { saveSettings } from "./settings";

let dir: string;
const SHEET = { name: "Site", folder: "site", description: "The site", tags: ["Adimeo", "Symfony"], status: "active" as const, note: "Deploy on Fridays" };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-share-"));
  process.env.PM_SECRET_KEY_PATH = join(dir, "secret.key");
});
afterAll(() => {
  delete process.env.PM_SECRET_KEY_PATH;
  rmSync(dir, { recursive: true, force: true });
});

function mine(): { db: Db; projectId: number } {
  const db = openDb(":memory:");
  const projectId = db.insert(projects).values({ path: "/me/site", name: "site" }).returning({ id: projects.id }).get().id;
  const vpnId = db.insert(vpns).values({ name: "GT", kind: "globalprotect", gateway: "vpn.gt.fr", routes: "192.168.200.0/24", sudoSlug: "gt" }).returning({ id: vpns.id }).get().id;
  db.insert(vpns).values({ name: "Villette", kind: "sudo_openvpn", configPath: "/me/villette.ovpn", sudoSlug: "villette" }).run();
  const prod = db.insert(remoteServers).values({ name: "Prod", kind: "ssh", host: "192.168.200.38", username: "adimeo", auth: "key", keyPath: "~/.ssh/id_me", passwordSecret: "sealed", vpnId }).returning({ id: remoteServers.id }).get().id;
  const env = db.insert(projectEnvironments).values({ projectId, name: "Prod", protected: true, urls: [{ label: "site", url: "https://site.fr" }] }).returning({ id: projectEnvironments.id }).get().id;
  db.insert(environmentAccesses).values({ environmentId: env, serverId: prod, label: "Web", path: "/var/www" }).run();
  saveSettings(db, { aliases: [{ name: "sf:cc", command: "php bin/console c:c" }, { name: "dr:cr", command: "drush cr" }] });
  saveRequest(db, projectId, null, { name: "Health", method: "GET", url: "{{baseUrl}}/health", headers: [{ name: "Authorization", value: "Bearer s3cret", secret: true, hasValue: false }], body: "" });
  db.insert(httpVariables).values([
    { projectId, environmentId: env, name: "user", value: "ada", secret: false },
    { projectId, environmentId: env, name: "token", value: "sealed-token", secret: true },
  ]).run();
  return { db, projectId };
}

describe("exporting", () => {
  it("keeps names and addresses, and leaves out every secret and key path", () => {
    const { db, projectId } = mine();
    const config = exportConfig(db, projectId, SHEET, new Date("2026-11-06T10:00:00Z"));
    const text = JSON.stringify(config);
    for (const secret of ["sealed", "s3cret", "id_me", "villette.ovpn"]) expect(text).not.toContain(secret);
    expect(config.servers).toEqual([{ name: "Prod", kind: "ssh", host: "192.168.200.38", port: null, username: "adimeo", auth: "agent", jumpHost: null, context: null, vpn: "GT" }]);
    expect(config.vpns).toEqual([{ name: "GT", kind: "globalprotect", gateway: "vpn.gt.fr", organization: null, routes: "192.168.200.0/24", dnsDomains: null }]);
    expect(config.http.variables).toEqual([
      { environment: "Prod", name: "token", value: "", secret: true },
      { environment: "Prod", name: "user", value: "ada", secret: false },
    ]);
    expect(readConfig(JSON.parse(text))).toEqual(config);
    expect(readConfig({ format: "other" })).toBeNull();
  });
});

describe("importing", () => {
  it("shows the plan without writing, then creates what is missing and keeps what exists", async () => {
    const source = mine();
    const config = exportConfig(source.db, source.projectId, SHEET);
    const db = openDb(":memory:");
    const projectId = db.insert(projects).values({ path: "/colleague/site", name: "site" }).returning({ id: projects.id }).get().id;
    saveSettings(db, { aliases: [{ name: "sf:cc", command: "php bin/console cache:clear" }] });

    const plan = await importConfig(db, projectId, config, false);
    expect(plan.items.map(({ kind, name, action }) => `${kind}:${name}:${action}`)).toEqual([
      "description:The site:create",
      "tag:Adimeo:create",
      "tag:Symfony:create",
      "status:active:create",
      "note:Deploy on Fridays:create",
      "vpn:GT:create",
      "server:Prod:create",
      "environment:Prod:create",
      "access:Prod · Web:create",
      "alias:sf:cc:keep",
      "alias:dr:cr:create",
      "request:Health:create",
      "variable:Prod · token:create",
      "variable:Prod · user:create",
    ]);
    expect(db.select().from(remoteServers).all()).toEqual([]);

    const done = await importConfig(db, projectId, config, true);
    expect(done.items.every(({ action }) => action !== "skip")).toBe(true);
    const server = db.select().from(remoteServers).get();
    expect(server).toMatchObject({ name: "Prod", auth: "agent", keyPath: null, passwordSecret: null });
    expect(server?.vpnId).toBe(db.select().from(vpns).get()?.id);
    expect(db.select().from(environmentAccesses).all()).toHaveLength(1);
    expect(db.select().from(httpRequests).get()?.headers).toEqual([{ name: "Authorization", value: "", secret: true }]);
    expect(db.select().from(httpVariables).all().map(({ name, value, secret }) => [name, value, secret])).toEqual([
      ["token", "", true],
      ["user", "ada", false],
    ]);

    const again = await importConfig(db, projectId, config, true);
    expect(again.items.filter(({ action }) => action === "create").map(({ kind }) => kind)).toEqual([]);
  });

  it("leaves an OpenVPN aside, which needs its file", async () => {
    const source = mine();
    const config = exportConfig(source.db, source.projectId, SHEET);
    config.vpns.push({ name: "Villette", kind: "sudo_openvpn", gateway: null, organization: null, routes: null });
    const db = openDb(":memory:");
    const projectId = db.insert(projects).values({ path: "/c", name: "c" }).returning({ id: projects.id }).get().id;
    expect((await importConfig(db, projectId, config, false)).items).toContainEqual({ kind: "vpn", name: "Villette", action: "skip", reason: "needsFile" });
  });
});

describe("the sheet", () => {
  it("fills only what is empty in an existing project", async () => {
    const source = mine();
    const config = exportConfig(source.db, source.projectId, SHEET);
    const db = openDb(":memory:");
    const projectId = db.insert(projects).values({ path: "/c", name: "c" }).returning({ id: projects.id }).get().id;
    setDescription(db, projectId, "Mine");
    await importConfig(db, projectId, config, true);
    expect(db.select().from(projectMeta).where(eq(projectMeta.projectId, projectId)).get()).toMatchObject({ description: "Mine", status: "active", note: "Deploy on Fridays" });
  });

  it("makes a new project in a folder already cloned, after saying what it will do", async () => {
    const source = mine();
    const config = exportConfig(source.db, source.projectId, SHEET);
    const db = openDb(":memory:");
    const folder = join(dir, "site");
    mkdirSync(folder, { recursive: true });

    expect(await importProject(db, join(dir, "nope"), config, false)).toHaveProperty("error");
    const plan = await importProject(db, folder, config, false);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.items[0]).toEqual({ kind: "project", name: `Site · ${folder}`, action: "create" });
    expect(db.select().from(projects).all()).toEqual([]);

    const done = await importProject(db, folder, config, true);
    if ("error" in done || done.projectId === null) throw new Error("not imported");
    expect(db.select().from(projectMeta).where(eq(projectMeta.projectId, done.projectId)).get()).toMatchObject({ displayName: "Site", description: "The site", status: "active", note: "Deploy on Fridays" });
    expect(db.select().from(projectEnvironments).all()).toHaveLength(1);
    expect(await importProject(db, folder, config, false)).toHaveProperty("error");
  });
});

describe("the APM project", () => {
  it("goes with the sheet, and only fills a project not linked yet", async () => {
    const source = mine();
    setApmProjectId(source.db, source.projectId, 665);
    const config = readConfig(JSON.parse(JSON.stringify(exportProject(source.db, source.projectId))));
    expect(config?.sheet?.apmProjectId).toBe(665);

    const db = openDb(":memory:");
    const fresh = db.insert(projects).values({ path: "/c", name: "c" }).returning({ id: projects.id }).get().id;
    const linked = db.insert(projects).values({ path: "/d", name: "d" }).returning({ id: projects.id }).get().id;
    setApmProjectId(db, linked, 12);
    const plan = await importConfig(db, fresh, config!, true);
    expect(plan.items).toContainEqual({ kind: "apm", name: "#665", action: "create", reason: undefined });
    await importConfig(db, linked, config!, true);
    expect([getApmProjectId(db, fresh), getApmProjectId(db, linked)]).toEqual([665, 12]);
  });

  it("is left aside when it is not a positive id", () => {
    const file = JSON.parse(JSON.stringify(exportConfig(mine().db, 1, { ...SHEET, apmProjectId: 1 })));
    file.sheet.apmProjectId = "665; drop";
    expect(readConfig(file)?.sheet).not.toHaveProperty("apmProjectId");
  });
});

describe("multi-projects", () => {
  function group(db: Db) {
    const root = join(dir, "anfr");
    const groupId = db.insert(projects).values({ path: root, name: "anfr", kind: "group" }).returning({ id: projects.id }).get().id;
    const api = db.insert(projects).values({ path: `${root}/api`, name: "api", parentId: groupId }).returning({ id: projects.id }).get().id;
    db.insert(projects).values({ path: `${root}/front`, name: "front", parentId: groupId }).run();
    db.insert(projectEnvironments).values({ projectId: api, name: "Recette", urls: [{ label: "api", url: "https://api.recette" }] }).run();
    setDescription(db, groupId, "All of ANFR");
    return groupId;
  }

  it("exports each sub-project in its folder, with the aliases once", () => {
    const db = openDb(":memory:");
    const config = exportProject(db, group(db));
    expect(config?.sheet?.name).toBe("anfr");
    expect(config?.subProjects.map(({ subdirectory, config: child }) => [subdirectory, child.sheet?.name, child.environments.map(({ name }) => name), child.aliases.length])).toEqual([
      ["api", "api", ["Recette"], 0],
      ["front", "front", [], 0],
    ]);
    expect(readConfig(JSON.parse(JSON.stringify(config)))?.subProjects).toHaveLength(2);
  });

  it("imports the sub-projects whose folders are there, and leaves the others aside", async () => {
    const source = openDb(":memory:");
    const config = exportProject(source, group(source));
    if (!config) throw new Error("no export");
    const root = join(dir, "clone-anfr");
    mkdirSync(join(root, "api"), { recursive: true });
    const db = openDb(":memory:");

    const plan = await importProject(db, root, config, false);
    if ("error" in plan) throw new Error(plan.error);
    expect(plan.items.filter(({ kind }) => kind === "project").map(({ name, action }) => `${name}:${action}`)).toEqual([`anfr · ${root}:create`, "api · api:create", "front · front:skip"]);

    const done = await importProject(db, root, config, true);
    if ("error" in done || done.projectId === null) throw new Error("not imported");
    const children = db.select().from(projects).where(eq(projects.parentId, done.projectId)).all();
    expect(children.map(({ path }) => path)).toEqual([join(root, "api")]);
    expect(db.select().from(projectEnvironments).where(eq(projectEnvironments.projectId, children[0].id)).all()).toHaveLength(1);

    // The other folder cloned since: importing into the multi-project adds it.
    mkdirSync(join(root, "front"));
    const into = await importInto(db, done.projectId, config, true);
    expect(into.items.filter(({ kind, action }) => kind === "project" && action === "create").map(({ name }) => name)).toEqual(["front · front"]);
    expect(db.select().from(projects).where(eq(projects.parentId, done.projectId)).all()).toHaveLength(2);
  });
});
