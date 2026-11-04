import { and, eq } from "drizzle-orm";
import { detectEngine, type Engine } from "@/lib/db-engines";
import type { Db } from "../db/client";
import { projectMeta, projects } from "../db/schema";
import { assignContainers, type DockerState, readDocker } from "../scan/docker";
import { type ContainerInfo, inspectInfo } from "./docker-run";

export type DatabaseContainer = {
  id: string;
  name: string;
  service: string;
  image: string;
  engine: Engine;
  projectId: number;
  projectName: string;
};

/** What the browser is told about a database: nothing of how to log in to it. */
export type DatabaseTarget = Omit<DatabaseContainer, never>;

export const publicTarget = ({ id, name, service, image, engine, projectId, projectName }: DatabaseContainer): DatabaseTarget => ({
  id,
  name,
  service,
  image,
  engine,
  projectId,
  projectName,
});

export type DatabaseContainers = { containers: (DatabaseContainer & { info: ContainerInfo })[]; error: string | null };

/**
 * Every running database of every project of the list. The login details stay in `info`,
 * on the server: what goes to the browser is built from the rest.
 */
export async function listDatabaseContainers(
  db: Db,
  { docker = readDocker, inspect = inspectInfo }: { docker?: () => Promise<DockerState>; inspect?: typeof inspectInfo } = {},
): Promise<DatabaseContainers> {
  const state = await docker();
  if (state.error) return { containers: [], error: state.error };

  const known = db
    .select({ id: projects.id, path: projects.path, name: projects.name, displayName: projectMeta.displayName })
    .from(projects)
    .leftJoin(projectMeta, eq(projectMeta.projectId, projects.id))
    .where(and(eq(projects.kind, "project"), eq(projects.abandoned, false)))
    .all();
  const assigned = assignContainers(known.map(({ path }) => path), state.containers);

  const owners = new Map<string, (typeof known)[number]>();
  for (const project of known) for (const container of assigned.get(project.path) ?? []) owners.set(container.name, project);
  if (owners.size === 0) return { containers: [], error: null };

  try {
    const infos = await inspect([...owners.keys()]);
    const containers = infos.flatMap((info) => {
      const owner = owners.get(info.name);
      const engine = detectEngine({ image: info.image, service: info.service, envKeys: Object.keys(info.env) });
      if (!owner || !engine || !info.running) return [];
      return [
        {
          id: info.id,
          name: info.name,
          service: info.service,
          image: info.image,
          engine,
          projectId: owner.id,
          projectName: owner.displayName ?? owner.name,
          info,
        },
      ];
    });
    containers.sort((a, b) => a.projectName.localeCompare(b.projectName, "fr") || a.name.localeCompare(b.name, "fr"));
    return { containers, error: null };
  } catch (error) {
    return { containers: [], error: (error as { stderr?: string }).stderr?.trim() || String(error) };
  }
}
