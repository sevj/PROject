import { and, eq } from "drizzle-orm";
import { detectEngine, type Engine, isRedis } from "@/lib/db-engines";
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

/** A Redis server of a project. The id starts with `redis:` so that it cannot be taken for a container of the dumps. */
export type RedisContainer = Omit<DatabaseContainer, "engine" | "id"> & { id: string; engine: "redis" };
export type RedisContainers = { containers: (RedisContainer & { info: ContainerInfo })[] };

export const redisTarget = ({ id, name, service, image, projectId, projectName }: RedisContainer): RedisContainer => ({
  id,
  name,
  service,
  image,
  engine: "redis",
  projectId,
  projectName,
});

/**
 * Every running database of every project of the list. The login details stay in `info`,
 * on the server: what goes to the browser is built from the rest.
 */
export async function listDatabaseContainers(
  db: Db,
  deps: { docker?: () => Promise<DockerState>; inspect?: typeof inspectInfo } = {},
): Promise<DatabaseContainers> {
  const { containers, error } = await listDatabaseServers(db, deps);
  return { containers, error };
}

/** The databases of the dumps and the Redis servers, from one look at Docker. */
export async function listDatabaseServers(
  db: Db,
  { docker = readDocker, inspect = inspectInfo }: { docker?: () => Promise<DockerState>; inspect?: typeof inspectInfo } = {},
): Promise<DatabaseContainers & { redis: RedisContainers["containers"] }> {
  const state = await docker();
  if (state.error) return { containers: [], redis: [], error: state.error };

  const known = db
    .select({ id: projects.id, path: projects.path, name: projects.name, displayName: projectMeta.displayName })
    .from(projects)
    .leftJoin(projectMeta, eq(projectMeta.projectId, projects.id))
    .where(and(eq(projects.kind, "project"), eq(projects.abandoned, false)))
    .all();
  const assigned = assignContainers(known.map(({ path }) => path), state.containers);

  const owners = new Map<string, (typeof known)[number]>();
  for (const project of known) for (const container of assigned.get(project.path) ?? []) owners.set(container.name, project);
  if (owners.size === 0) return { containers: [], redis: [], error: null };

  try {
    const infos = await inspect([...owners.keys()]);
    const containers: DatabaseContainers["containers"] = [];
    const redis: RedisContainers["containers"] = [];
    for (const info of infos) {
      const owner = owners.get(info.name);
      if (!owner || !info.running) continue;
      const projectName = owner.displayName ?? owner.name;
      const engine = detectEngine({ image: info.image, service: info.service, envKeys: Object.keys(info.env) });
      if (engine) {
        containers.push({ id: info.id, name: info.name, service: info.service, image: info.image, engine, projectId: owner.id, projectName, info });
      } else if (isRedis({ image: info.image, service: info.service, envKeys: Object.keys(info.env) })) {
        redis.push({ id: `redis:${info.id}`, name: info.name, service: info.service, image: info.image, engine: "redis", projectId: owner.id, projectName, info });
      }
    }
    const byName = (a: { projectName: string; name: string }, b: { projectName: string; name: string }) =>
      a.projectName.localeCompare(b.projectName, "fr") || a.name.localeCompare(b.name, "fr");
    containers.sort(byName);
    redis.sort(byName);
    return { containers, redis, error: null };
  } catch (error) {
    return { containers: [], redis: [], error: (error as { stderr?: string }).stderr?.trim() || String(error) };
  }
}
