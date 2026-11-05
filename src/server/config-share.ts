import { and, eq, inArray, isNull } from "drizzle-orm";
import { type CommandAlias, normalizeAliases } from "@/lib/aliases";
import { isHttpMethod, VARIABLE_NAME } from "@/lib/http-requests";
import type { Db } from "./db/client";
import { environmentAccesses, httpRequests, httpVariables, projectEnvironments, remoteServers, vpns } from "./db/schema";
import { saveRequest } from "./http-requests";
import { saveAccess, saveEnvironment, saveServer } from "./remote-servers";
import { getSettings, saveSettings } from "./settings";
import { saveVpn } from "./vpn";

export const CONFIG_FORMAT = "project-manager/config";
export const CONFIG_VERSION = 1;

type SharedServer = {
  name: string;
  kind: "ssh" | "kubernetes";
  host: string | null;
  port: number | null;
  username: string | null;
  /** "key" leaves as "agent": the path of a key is the person's own. */
  auth: "alias" | "agent" | "password" | null;
  jumpHost: string | null;
  context: string | null;
  vpn: string | null;
};
type SharedVpn = { name: string; kind: "openvpn" | "sudo_openvpn" | "nordlayer" | "globalprotect"; gateway: string | null; organization: string | null; routes: string | null };
type SharedAccess = { server: string; label: string; path: string | null; namespace: string | null; target: string | null; container: string | null };
type SharedEnvironment = { name: string; protected: boolean; urls: { label: string; url: string }[]; notes: string | null; accesses: SharedAccess[] };
type SharedRequest = { name: string; method: string; url: string; headers: { name: string; value: string; secret: boolean }[]; body: string };
type SharedVariable = { environment: string | null; name: string; value: string; secret: boolean };

/** What a file holds: names and addresses, never a password, a key, a token or a secret's value. */
export type SharedConfig = {
  format: typeof CONFIG_FORMAT;
  version: typeof CONFIG_VERSION;
  exportedAt: string;
  project: string;
  servers: SharedServer[];
  vpns: SharedVpn[];
  environments: SharedEnvironment[];
  aliases: CommandAlias[];
  http: { requests: SharedRequest[]; variables: SharedVariable[] };
};

export function exportConfig(db: Db, projectId: number, projectName: string, now = new Date()): SharedConfig {
  const environments = db.select().from(projectEnvironments).where(eq(projectEnvironments.projectId, projectId)).all();
  const accesses = environments.length === 0 ? [] : db.select().from(environmentAccesses).where(inArray(environmentAccesses.environmentId, environments.map(({ id }) => id))).all();
  const serverRows = accesses.length === 0 ? [] : db.select().from(remoteServers).where(inArray(remoteServers.id, [...new Set(accesses.map(({ serverId }) => serverId))])).all();
  const vpnRows = db.select().from(vpns).all();
  const vpnName = (id: number | null) => vpnRows.find((vpn) => vpn.id === id)?.name ?? null;
  const usedVpns = vpnRows.filter((vpn) => serverRows.some(({ vpnId }) => vpnId === vpn.id));
  const envName = (id: number | null) => (id === null ? null : (environments.find((environment) => environment.id === id)?.name ?? null));
  const requests = db.select().from(httpRequests).where(eq(httpRequests.projectId, projectId)).all();
  const variables = db.select().from(httpVariables).where(eq(httpVariables.projectId, projectId)).all();
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    exportedAt: now.toISOString(),
    project: projectName,
    servers: serverRows.map((server) => ({
      name: server.name,
      kind: server.kind,
      host: server.host,
      port: server.port,
      username: server.username,
      auth: server.auth === "key" ? "agent" : server.auth,
      jumpHost: server.jumpHost,
      context: server.context,
      vpn: vpnName(server.vpnId),
    })),
    vpns: usedVpns.map((vpn) => ({ name: vpn.name, kind: vpn.kind, gateway: vpn.gateway, organization: vpn.organization, routes: vpn.routes })),
    environments: environments.map((environment) => ({
      name: environment.name,
      protected: environment.protected,
      urls: environment.urls,
      notes: environment.notes,
      accesses: accesses
        .filter(({ environmentId }) => environmentId === environment.id)
        .map((access) => ({
          server: serverRows.find(({ id }) => id === access.serverId)?.name ?? "",
          label: access.label,
          path: access.path,
          namespace: access.namespace,
          target: access.target,
          container: access.container,
        })),
    })),
    aliases: getSettings(db).aliases,
    http: {
      requests: requests.map((request) => ({
        name: request.name,
        method: request.method,
        url: request.url,
        headers: request.headers.map((header) => ({ name: header.name, value: header.secret ? "" : header.value, secret: header.secret })),
        body: request.body ?? "",
      })),
      variables: variables
        .filter(({ environmentId }) => environmentId === null || envName(environmentId) !== null)
        // By name, so that two exports of the same thing are the same file.
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((variable) => ({ environment: envName(variable.environmentId), name: variable.name, value: variable.secret ? "" : variable.value, secret: variable.secret })),
    },
  };
}

const text = (value: unknown, max = 2000) => (typeof value === "string" ? value.slice(0, max) : null);
const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : []);

/** The file read back, shape checked field by field: anything else in it is left aside. */
export function readConfig(raw: unknown): SharedConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const file = raw as Record<string, unknown>;
  if (file.format !== CONFIG_FORMAT || file.version !== CONFIG_VERSION) return null;
  const http = (file.http && typeof file.http === "object" ? file.http : {}) as Record<string, unknown>;
  const kinds = ["openvpn", "sudo_openvpn", "nordlayer", "globalprotect"] as const;
  const auths = ["alias", "agent", "password"] as const;
  return {
    format: CONFIG_FORMAT,
    version: CONFIG_VERSION,
    exportedAt: text(file.exportedAt, 40) ?? "",
    project: text(file.project, 120) ?? "",
    servers: list(file.servers).flatMap((item) => {
      const name = text(item.name, 80);
      if (!name || (item.kind !== "ssh" && item.kind !== "kubernetes")) return [];
      return [
        {
          name,
          kind: item.kind,
          host: text(item.host, 255),
          port: Number.isInteger(item.port) ? (item.port as number) : null,
          username: text(item.username, 64),
          auth: auths.find((auth) => auth === item.auth) ?? (item.kind === "ssh" ? "agent" : null),
          jumpHost: text(item.jumpHost, 255),
          context: text(item.context, 255),
          vpn: text(item.vpn, 80),
        },
      ];
    }),
    vpns: list(file.vpns).flatMap((item) => {
      const name = text(item.name, 80);
      const kind = kinds.find((value) => value === item.kind);
      return name && kind ? [{ name, kind, gateway: text(item.gateway, 255), organization: text(item.organization, 80), routes: text(item.routes, 1000) }] : [];
    }),
    environments: list(file.environments).flatMap((item) => {
      const name = text(item.name, 80);
      if (!name) return [];
      return [
        {
          name,
          protected: item.protected === true,
          urls: list(item.urls).flatMap((url) => (text(url.url) ? [{ label: text(url.label, 80) ?? "", url: text(url.url) as string }] : [])),
          notes: text(item.notes, 4000),
          accesses: list(item.accesses).flatMap((access) => {
            const server = text(access.server, 80);
            const label = text(access.label, 80);
            return server && label ? [{ server, label, path: text(access.path, 1000), namespace: text(access.namespace, 255), target: text(access.target, 255), container: text(access.container, 255) }] : [];
          }),
        },
      ];
    }),
    aliases: normalizeAliases(file.aliases),
    http: {
      requests: list(http.requests).flatMap((item) => {
        const name = text(item.name, 120);
        if (!name || !isHttpMethod(item.method)) return [];
        return [
          {
            name,
            method: item.method,
            url: text(item.url, 8000) ?? "",
            headers: list(item.headers).map((header) => ({ name: text(header.name, 200) ?? "", value: header.secret === true ? "" : (text(header.value, 8000) ?? ""), secret: header.secret === true })),
            body: text(item.body, 200_000) ?? "",
          },
        ];
      }),
      variables: list(http.variables).flatMap((item) => {
        const name = text(item.name, 64);
        return name ? [{ environment: text(item.environment, 80), name, value: item.secret === true ? "" : (text(item.value, 8000) ?? ""), secret: item.secret === true }] : [];
      }),
    },
  };
}

export type PlanAction = "create" | "keep" | "skip";
export type PlanItem = { kind: "server" | "vpn" | "environment" | "access" | "alias" | "request" | "variable"; name: string; action: PlanAction; reason?: "exists" | "needsFile" | "noServer" | "invalid" };
export type ImportResult = { items: PlanItem[] };

/**
 * What importing this file into the project does, and with `apply` does it. Nothing that exists
 * is changed: a server, VPN, environment, alias, request or variable of the same name is kept as
 * it is. Secrets come empty, to be typed by whoever imports.
 */
export async function importConfig(db: Db, projectId: number, config: SharedConfig, apply: boolean): Promise<ImportResult> {
  const items: PlanItem[] = [];

  // VPNs, by name. An OpenVPN one needs its file, which only its owner has.
  const vpnIds = new Map(db.select({ id: vpns.id, name: vpns.name }).from(vpns).all().map(({ id, name }) => [name, id] as const));
  for (const vpn of config.vpns) {
    if (vpnIds.has(vpn.name)) {
      items.push({ kind: "vpn", name: vpn.name, action: "keep", reason: "exists" });
    } else if (vpn.kind === "openvpn" || vpn.kind === "sudo_openvpn") {
      items.push({ kind: "vpn", name: vpn.name, action: "skip", reason: "needsFile" });
    } else if (!apply) {
      items.push({ kind: "vpn", name: vpn.name, action: "create" });
    } else {
      const saved = await saveVpn(db, null, { name: vpn.name, kind: vpn.kind, configPath: null, username: null, password: "", tokenAppended: false, gateway: vpn.gateway, organization: vpn.organization, routes: vpn.routes });
      if ("id" in saved) vpnIds.set(vpn.name, saved.id);
      items.push({ kind: "vpn", name: vpn.name, action: "id" in saved ? "create" : "skip", reason: "id" in saved ? undefined : "invalid" });
    }
  }

  // Servers, by name, tied to their VPN when there is one of that name.
  const serverIds = new Map(db.select({ id: remoteServers.id, name: remoteServers.name }).from(remoteServers).all().map(({ id, name }) => [name, id] as const));
  for (const server of config.servers) {
    if (serverIds.has(server.name)) {
      items.push({ kind: "server", name: server.name, action: "keep", reason: "exists" });
      continue;
    }
    const input = { name: server.name, kind: server.kind, host: server.host, port: server.port, username: server.username, auth: server.auth, keyPath: null, jumpHost: server.jumpHost, context: server.context, vpnId: server.vpn ? (vpnIds.get(server.vpn) ?? null) : null };
    if (!apply) {
      items.push({ kind: "server", name: server.name, action: "create" });
      continue;
    }
    const saved = saveServer(db, null, input);
    if ("id" in saved) serverIds.set(server.name, saved.id);
    items.push({ kind: "server", name: server.name, action: "id" in saved ? "create" : "skip", reason: "id" in saved ? undefined : "invalid" });
  }

  // Environments of this project, by name, with their accesses when the environment is new.
  const environmentIds = new Map(
    db.select({ id: projectEnvironments.id, name: projectEnvironments.name }).from(projectEnvironments).where(eq(projectEnvironments.projectId, projectId)).all().map(({ id, name }) => [name, id] as const),
  );
  for (const environment of config.environments) {
    if (environmentIds.has(environment.name)) {
      items.push({ kind: "environment", name: environment.name, action: "keep", reason: "exists" });
      continue;
    }
    let environmentId: number | null = null;
    if (apply) {
      const saved = saveEnvironment(db, projectId, null, { name: environment.name, protected: environment.protected, urls: environment.urls, notes: environment.notes });
      if (!("id" in saved)) {
        items.push({ kind: "environment", name: environment.name, action: "skip", reason: "invalid" });
        continue;
      }
      environmentId = saved.id;
      environmentIds.set(environment.name, saved.id);
    }
    items.push({ kind: "environment", name: environment.name, action: "create" });
    for (const access of environment.accesses) {
      const label = `${environment.name} · ${access.label}`;
      const serverId = serverIds.get(access.server);
      const planned = config.servers.some(({ name }) => name === access.server);
      if (serverId === undefined && !(planned && !apply)) {
        items.push({ kind: "access", name: label, action: "skip", reason: "noServer" });
        continue;
      }
      if (apply && environmentId !== null && serverId !== undefined) {
        const saved = saveAccess(db, projectId, environmentId, null, { serverId, label: access.label, path: access.path, namespace: access.namespace, target: access.target, container: access.container });
        items.push({ kind: "access", name: label, action: "id" in saved ? "create" : "skip", reason: "id" in saved ? undefined : "invalid" });
      } else {
        items.push({ kind: "access", name: label, action: "create" });
      }
    }
  }

  // Aliases, shared by the whole app: only the missing names are added.
  const aliases = getSettings(db).aliases;
  const added = config.aliases.filter((alias) => !aliases.some(({ name }) => name === alias.name));
  for (const alias of config.aliases) items.push({ kind: "alias", name: alias.name, action: added.includes(alias) ? "create" : "keep", reason: added.includes(alias) ? undefined : "exists" });
  if (apply && added.length > 0) saveSettings(db, { aliases: [...aliases, ...added].slice(0, 50) });

  // HTTP requests and variables of this project, by name.
  const requestNames = new Set(db.select({ name: httpRequests.name }).from(httpRequests).where(eq(httpRequests.projectId, projectId)).all().map(({ name }) => name));
  for (const request of config.http.requests) {
    if (requestNames.has(request.name)) {
      items.push({ kind: "request", name: request.name, action: "keep", reason: "exists" });
      continue;
    }
    if (apply) {
      const saved = saveRequest(db, projectId, null, { ...request, headers: request.headers.map((header) => ({ ...header, hasValue: false })) });
      items.push({ kind: "request", name: request.name, action: "id" in saved ? "create" : "skip", reason: "id" in saved ? undefined : "invalid" });
    } else {
      items.push({ kind: "request", name: request.name, action: "create" });
    }
    requestNames.add(request.name);
  }
  for (const variable of config.http.variables) {
    const label = `${variable.environment ?? "Local"} · ${variable.name}`;
    if (!VARIABLE_NAME.test(variable.name)) {
      items.push({ kind: "variable", name: label, action: "skip", reason: "invalid" });
      continue;
    }
    const environmentId = variable.environment === null ? null : environmentIds.get(variable.environment);
    if (environmentId === undefined) {
      // Its environment is created above only when applying.
      const coming = !apply && config.environments.some(({ name }) => name === variable.environment);
      items.push({ kind: "variable", name: label, action: coming ? "create" : "skip", reason: coming ? undefined : "invalid" });
      continue;
    }
    const scope = and(eq(httpVariables.projectId, projectId), environmentId === null ? isNull(httpVariables.environmentId) : eq(httpVariables.environmentId, environmentId), eq(httpVariables.name, variable.name));
    if (db.select({ id: httpVariables.id }).from(httpVariables).where(scope).get()) {
      items.push({ kind: "variable", name: label, action: "keep", reason: "exists" });
      continue;
    }
    if (apply) db.insert(httpVariables).values({ projectId, environmentId, name: variable.name, value: variable.value, secret: variable.secret }).run();
    items.push({ kind: "variable", name: label, action: "create" });
  }
  return { items };
}
