import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import { buildPortRows, parseDeclaredPort, parseListeners, parsePsPorts, type PortEntry, type PortRow } from "@/lib/ports";
import type { Db } from "./db/client";
import { projectFacts, projects } from "./db/schema";
import { readDockerStack } from "./docker-stack";
import { assignContainers, readDocker } from "./scan/docker";

const run = promisify(execFile);

export type PortReport = { rows: PortRow[]; dockerError: string | null; hostError: string | null };

async function readHostListeners(): Promise<{ entries: PortEntry[]; error: string | null }> {
  try {
    const { stdout } = await run("ss", ["-tlnpH"], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    return {
      error: null,
      entries: parseListeners(stdout).map(({ port, address, process }) => ({
        port,
        protocol: "tcp" as const,
        kind: "host" as const,
        owner: `host:${process ?? port}`,
        label: process ?? "?",
        projectId: null,
        projectName: null,
        address,
      })),
    };
  } catch (error) {
    return { entries: [], error: (error as { stderr?: string }).stderr?.trim() || String(error) };
  }
}

/** Read when asked and never stored: Docker and the system are the only places that know. */
export async function readPorts(db: Db): Promise<PortReport> {
  const known = db
    .select({ id: projects.id, name: projects.name, path: projects.path, hasCompose: projectFacts.hasCompose })
    .from(projects)
    .leftJoin(projectFacts, eq(projectFacts.projectId, projects.id))
    .where(and(eq(projects.kind, "project"), eq(projects.abandoned, false)))
    .all();

  const [docker, host, declared] = await Promise.all([
    readDocker(),
    readHostListeners(),
    // Compose files are read for every project that has one, running or not.
    Promise.all(
      known
        .filter((project) => project.hasCompose)
        .map(async (project) => {
          const stack = await readDockerStack(project.path).catch(() => ({ components: [] }));
          return stack.components.flatMap((component) =>
            component.ports.flatMap((text) =>
              parseDeclaredPort(text).map(({ port, protocol, address }): PortEntry => ({
                port,
                protocol,
                kind: "declared",
                owner: `p:${project.id}:${component.service}`,
                label: component.service,
                projectId: project.id,
                projectName: project.name,
                address,
              })),
            ),
          );
        }),
    ),
  ]);

  const byPath = new Map(known.map((project) => [project.path, project]));
  const assigned = assignContainers(known.map(({ path }) => path), docker.containers);
  const owners = new Map<string, (typeof known)[number]>();
  for (const [path, containers] of assigned) {
    const project = byPath.get(path);
    if (project) for (const container of containers) owners.set(container.name, project);
  }

  const published = docker.containers
    .filter((container) => container.state === "running")
    .flatMap((container) => {
      const project = owners.get(container.name) ?? null;
      return parsePsPorts(container.ports).map(
        ({ port, protocol, address }): PortEntry => ({
          port,
          protocol,
          kind: "docker",
          owner: project ? `p:${project.id}:${container.service}` : `container:${container.name}`,
          label: project ? container.service || container.name : container.name,
          projectId: project?.id ?? null,
          projectName: project?.name ?? null,
          address,
        }),
      );
    });

  return {
    rows: buildPortRows([...published, ...declared.flat(), ...host.entries]),
    dockerError: docker.error,
    hostError: host.error,
  };
}
