import { detectEngine } from "@/lib/db-engines";
import type { Db } from "./db/client";
import { readDockerOverview } from "./docker-overview";
import { getRegistry } from "./registry";
import { listEnvironments, listServers } from "./remote-servers";
import { readVpnStatuses, type VpnStatus } from "./vpn";

export type PaletteProject = { id: number; name: string; parentName: string | null; stacks: string[]; branch: string | null; hasDocker: boolean };
export type PaletteContainer = { id: string; name: string; service: string; projectId: number; projectName: string; running: boolean; database: boolean };
export type PaletteAccess = { accessId: number; projectId: number; projectName: string; environment: string; label: string; protected: boolean; server: string };
export type PaletteServer = { id: number; name: string; kind: string; host: string | null };

export type PaletteData = {
  projects: PaletteProject[];
  containers: PaletteContainer[];
  accesses: PaletteAccess[];
  servers: PaletteServer[];
  vpns: VpnStatus[];
};

/** All the palette can find, read when it opens: names and states only, never a secret. */
export async function readPaletteData(db: Db): Promise<PaletteData> {
  const rows = getRegistry(db).rows.filter(({ abandoned, missing }) => !abandoned && !missing);
  const names = new Map(rows.map(({ id, name }) => [id, name]));
  const [overview, vpns] = await Promise.all([readDockerOverview(db), readVpnStatuses(db)]);
  const containers = overview.groups.flatMap((group) =>
    group.projectId === null || !names.has(group.projectId)
      ? []
      : group.containers.map((container) => ({
          id: container.id,
          name: container.name,
          service: container.service,
          projectId: group.projectId as number,
          projectName: names.get(group.projectId as number) ?? group.label,
          running: container.running && container.state !== "paused",
          database: detectEngine({ image: container.image, service: container.service }) !== null,
        })),
  );
  const accesses = rows.flatMap((row) =>
    listEnvironments(db, row.id).flatMap((environment) =>
      environment.accesses
        // `kubectl exec` needs something to enter.
        .filter((access) => access.serverKind === "ssh" || access.target !== null)
        .map((access) => ({
          accessId: access.id,
          projectId: row.id,
          projectName: row.name,
          environment: environment.name,
          label: access.label,
          protected: environment.protected,
          server: access.serverName,
        })),
    ),
  );
  return {
    projects: rows.map((row) => ({
      id: row.id,
      name: row.name,
      parentName: row.parentName,
      stacks: row.stacks,
      branch: row.branch,
      hasDocker: containers.some(({ projectId }) => projectId === row.id),
    })),
    containers,
    accesses,
    servers: listServers(db).map(({ id, name, kind, host }) => ({ id, name, kind, host })),
    vpns,
  };
}
