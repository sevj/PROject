import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportConfig, importConfig, readConfig } from "./config-share";
import { type Db, openDb } from "./db/client";
import { environmentAccesses, httpRequests, httpVariables, projectEnvironments, projects, remoteServers, vpns } from "./db/schema";
import { saveRequest } from "./http-requests";
import { saveSettings } from "./settings";

let dir: string;

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
    const config = exportConfig(db, projectId, "Site", new Date("2026-11-06T10:00:00Z"));
    const text = JSON.stringify(config);
    for (const secret of ["sealed", "s3cret", "id_me", "villette.ovpn"]) expect(text).not.toContain(secret);
    expect(config.servers).toEqual([{ name: "Prod", kind: "ssh", host: "192.168.200.38", port: null, username: "adimeo", auth: "agent", jumpHost: null, context: null, vpn: "GT" }]);
    expect(config.vpns).toEqual([{ name: "GT", kind: "globalprotect", gateway: "vpn.gt.fr", organization: null, routes: "192.168.200.0/24" }]);
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
    const config = exportConfig(source.db, source.projectId, "Site");
    const db = openDb(":memory:");
    const projectId = db.insert(projects).values({ path: "/colleague/site", name: "site" }).returning({ id: projects.id }).get().id;
    saveSettings(db, { aliases: [{ name: "sf:cc", command: "php bin/console cache:clear" }] });

    const plan = await importConfig(db, projectId, config, false);
    expect(plan.items.map(({ kind, name, action }) => `${kind}:${name}:${action}`)).toEqual([
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
    const config = exportConfig(source.db, source.projectId, "Site");
    config.vpns.push({ name: "Villette", kind: "sudo_openvpn", gateway: null, organization: null, routes: null });
    const db = openDb(":memory:");
    const projectId = db.insert(projects).values({ path: "/c", name: "c" }).returning({ id: projects.id }).get().id;
    expect((await importConfig(db, projectId, config, false)).items).toContainEqual({ kind: "vpn", name: "Villette", action: "skip", reason: "needsFile" });
  });
});
