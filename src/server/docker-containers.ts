import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { projects } from "./db/schema";
import { assignContainers, type DockerContainer, type DockerState, readDocker } from "./scan/docker";

const run = promisify(execFile);

export type ContainerPort = { host: string | null; container: string };
export type ContainerMount = { type: string; source: string; destination: string; readOnly: boolean };

export type ContainerDetail = {
  /** The full 64-character id: what actions are sent with. */
  id: string;
  name: string;
  service: string;
  state: string;
  /** As `docker ps` words it, such as "Up 2 weeks (healthy)". */
  status: string;
  running: boolean;
  health: string | null;
  image: string;
  imageId: string;
  command: string;
  createdAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  outOfMemory: boolean;
  restartPolicy: string;
  restartCount: number;
  ports: ContainerPort[];
  networks: { name: string; address: string }[];
  mounts: ContainerMount[];
  composeProject: string | null;
  composeFiles: string[];
  workingDir: string | null;
};

type Raw = {
  Id?: string;
  Name?: string;
  Created?: string;
  Path?: string;
  Args?: string[];
  Image?: string;
  RestartCount?: number;
  State?: {
    Status?: string;
    Running?: boolean;
    ExitCode?: number;
    StartedAt?: string;
    FinishedAt?: string;
    OOMKilled?: boolean;
    Health?: { Status?: string };
  };
  HostConfig?: { RestartPolicy?: { Name?: string; MaximumRetryCount?: number } };
  Config?: { Image?: string; Labels?: Record<string, string> | null };
  NetworkSettings?: {
    Ports?: Record<string, { HostIp?: string; HostPort?: string }[] | null> | null;
    Networks?: Record<string, { IPAddress?: string }> | null;
  };
  Mounts?: { Type?: string; Name?: string; Source?: string; Destination?: string; RW?: boolean }[] | null;
};

/** Docker writes "0001-01-01…" for a date that never happened. */
function toTime(value: string | undefined): number | null {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) || time < 86_400_000 ? null : time;
}

/** A port is bound on IPv4 and IPv6 alike, which is one line for the reader. */
function toPorts(ports: NonNullable<Raw["NetworkSettings"]>["Ports"]): ContainerPort[] {
  const result: ContainerPort[] = [];
  const seen = new Set<string>();
  for (const [container, bindings] of Object.entries(ports ?? {})) {
    if (!bindings || bindings.length === 0) {
      result.push({ host: null, container });
      continue;
    }
    for (const { HostIp = "", HostPort = "" } of bindings) {
      const address = HostIp === "" || HostIp === "0.0.0.0" || HostIp === "::" ? "" : `${HostIp}:`;
      const key = `${address}${HostPort}->${container}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ host: `${address}${HostPort}`, container });
    }
  }
  return result;
}

/** Environment variables are not read: they can hold secrets that nobody asked for. */
export function toContainerDetail(raw: Raw, status = ""): ContainerDetail {
  const labels = raw.Config?.Labels ?? {};
  const state = raw.State ?? {};
  const policy = raw.HostConfig?.RestartPolicy;
  return {
    id: raw.Id ?? "",
    name: (raw.Name ?? "").replace(/^\//, ""),
    service: labels["com.docker.compose.service"] ?? "",
    state: state.Status ?? "",
    status,
    running: state.Running === true,
    health: state.Health?.Status ?? null,
    image: raw.Config?.Image ?? "",
    imageId: (raw.Image ?? "").replace(/^sha256:/, ""),
    command: [raw.Path, ...(raw.Args ?? [])].filter(Boolean).join(" "),
    createdAt: toTime(raw.Created),
    startedAt: toTime(state.StartedAt),
    finishedAt: toTime(state.FinishedAt),
    exitCode: state.Running ? null : (state.ExitCode ?? null),
    outOfMemory: state.OOMKilled === true,
    restartPolicy:
      !policy?.Name || policy.Name === "no"
        ? "no"
        : policy.Name === "on-failure" && policy.MaximumRetryCount
          ? `on-failure:${policy.MaximumRetryCount}`
          : policy.Name,
    restartCount: raw.RestartCount ?? 0,
    ports: toPorts(raw.NetworkSettings?.Ports),
    networks: Object.entries(raw.NetworkSettings?.Networks ?? {}).map(([name, { IPAddress = "" }]) => ({
      name,
      address: IPAddress,
    })),
    mounts: (raw.Mounts ?? []).map(({ Type = "", Name, Source = "", Destination = "", RW = true }) => ({
      type: Type,
      // A volume's source is a path inside Docker's own storage, which says nothing useful.
      source: Type === "volume" && Name ? Name : Source,
      destination: Destination,
      readOnly: !RW,
    })),
    composeProject: labels["com.docker.compose.project"] ?? null,
    composeFiles: (labels["com.docker.compose.project.config_files"] ?? "").split(",").filter(Boolean),
    workingDir: labels["com.docker.compose.project.working_dir"] ?? null,
  };
}

export function parseInspect(output: string): Raw[] {
  return output
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Raw];
      } catch {
        return [];
      }
    });
}

export async function inspectContainers(names: string[]): Promise<Raw[]> {
  if (names.length === 0) return [];
  const { stdout } = await run("docker", ["inspect", "--type", "container", "--format", "{{json .}}", ...names], {
    timeout: 20_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return parseInspect(stdout);
}

export type ProjectContainers = { containers: ContainerDetail[]; error: string | null };

type Sources = {
  docker?: () => Promise<DockerState>;
  inspect?: (names: string[]) => Promise<Raw[]>;
};

/** Read when asked and never stored: Docker is the only place that knows. */
export async function listProjectContainers(
  db: Db,
  projectId: number,
  { docker = readDocker, inspect = inspectContainers }: Sources = {},
): Promise<ProjectContainers> {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return { containers: [], error: null };

  const state = await docker();
  if (state.error) return { containers: [], error: state.error };

  const known = db
    .select({ path: projects.path })
    .from(projects)
    .where(and(eq(projects.kind, "project"), eq(projects.abandoned, false)))
    .all()
    .map(({ path }) => path);
  const ours = (assignContainers(known, state.containers).get(project.path) ?? []) as DockerContainer[];
  if (ours.length === 0) return { containers: [], error: null };

  try {
    const statuses = new Map(ours.map(({ name, status }) => [name, status]));
    const containers = (await inspect(ours.map(({ name }) => name)))
      .map((raw) => toContainerDetail(raw, statuses.get((raw.Name ?? "").replace(/^\//, "")) ?? ""))
      .sort((a, b) => a.service.localeCompare(b.service, "fr") || a.name.localeCompare(b.name, "fr"));
    return { containers, error: null };
  } catch (error) {
    const message = (error as { stderr?: string }).stderr?.trim() || String(error);
    return { containers: [], error: message };
  }
}
