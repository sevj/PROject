import { and, eq } from "drizzle-orm";
import { detectEngine } from "@/lib/db-engines";
import { type MapProject, type MapService, type MapState, toMapState } from "@/lib/project-map";
import type { Db } from "./db/client";
import { projectFacts, projectMeta, projects } from "./db/schema";
import { readDockerStack } from "./docker-stack";
import { assignContainers, readDocker } from "./scan/docker";

export type ProjectMap = { projects: MapProject[]; error: string | null };

const RANK: Record<MapState, number> = { running: 0, other: 1, stopped: 2, absent: 3 };

/** Read when asked and never stored: what the compose files declare, and what Docker runs now. */
export async function readProjectMap(db: Db): Promise<ProjectMap> {
  const known = db
    .select({ id: projects.id, name: projects.name, displayName: projectMeta.displayName, path: projects.path, hasCompose: projectFacts.hasCompose })
    .from(projects)
    .leftJoin(projectFacts, eq(projectFacts.projectId, projects.id))
    .leftJoin(projectMeta, eq(projectMeta.projectId, projects.id))
    .where(and(eq(projects.kind, "project"), eq(projects.abandoned, false)))
    .all();

  const docker = await readDocker();
  const live = assignContainers(known.map(({ path }) => path), docker.containers);

  const result: MapProject[] = [];
  for (const project of known) {
    const stack = project.hasCompose ? await readDockerStack(project.path).catch(() => ({ components: [] })) : { components: [] };
    const containers = live.get(project.path) ?? [];
    const stateOf = (service: string): MapState => {
      const states = containers.filter((container) => container.service === service).map((container) => toMapState(container.state));
      return states.sort((a, b) => RANK[a] - RANK[b])[0] ?? "absent";
    };

    const services = new Map<string, MapService>();
    for (const component of stack.components) {
      const image = component.images[0] ? `${component.images[0].name}:${component.images[0].version}` : null;
      services.set(component.service, {
        name: component.service,
        image,
        engine: detectEngine({ image: image ?? "", service: component.service }),
        state: stateOf(component.service),
        ports: component.ports,
        dependsOn: component.dependsOn,
      });
    }
    // A container of the project that no compose file we read declares is still part of it.
    for (const container of containers) {
      if (container.service && !services.has(container.service)) {
        services.set(container.service, {
          name: container.service,
          image: null,
          engine: detectEngine({ image: "", service: container.service }),
          state: stateOf(container.service),
          ports: [],
          dependsOn: [],
        });
      }
    }
    if (services.size > 0) result.push({ id: project.id, name: project.displayName ?? project.name, services: [...services.values()] });
  }
  result.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return { projects: result, error: docker.error };
}
