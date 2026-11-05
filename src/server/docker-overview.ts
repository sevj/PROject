import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { type ContainerGroup, groupContainers, idsToAct, OVERVIEW_FORMAT, type OverviewAction, type OverviewContainer, parseOverview } from "@/lib/docker-overview";
import type { Db } from "./db/client";
import { projectMeta, projects } from "./db/schema";
import { runContainers } from "./project-actions";

const run = promisify(execFile);

export type DockerOverview = { groups: ContainerGroup[]; error: string | null };

async function listAll(): Promise<{ containers: OverviewContainer[]; error: string | null }> {
  try {
    const { stdout } = await run("docker", ["ps", "-a", "--no-trunc", "--format", OVERVIEW_FORMAT], { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
    return { containers: parseOverview(stdout), error: null };
  } catch (error) {
    // Docker stopped is a state to show, not a crash.
    return { containers: [], error: (error as { stderr?: string }).stderr?.trim() || String(error) };
  }
}

/** Every container on the machine, by project. */
export async function readDockerOverview(db: Db): Promise<DockerOverview> {
  const { containers, error } = await listAll();
  const known = db
    .select({ id: projects.id, name: projects.name, displayName: projectMeta.displayName, path: projects.path })
    .from(projects)
    .leftJoin(projectMeta, eq(projectMeta.projectId, projects.id))
    .all()
    .map(({ id, name, displayName, path }) => ({ id, name: displayName ?? name, path }));
  return { groups: groupContainers(containers, known), error };
}

/** The ids come from the page: only those Docker lists now, and for which the action makes sense, are acted on. */
export async function actOnContainers(action: OverviewAction, asked: string[]): Promise<{ done: number } | { error: string }> {
  const { containers, error } = await listAll();
  if (error) return { error };
  const ids = idsToAct(action, asked, containers);
  if (ids.length === 0) return { done: 0 };
  const failure = await runContainers(action, ids);
  return failure ? { error: failure } : { done: ids.length };
}
