import { classifyStatus, STATE_ORDER, type StateKind } from "./docker-state";

/** Every field `docker ps` gives on one line, tab-separated, in this order. */
export const OVERVIEW_FORMAT = [
  "{{.ID}}",
  "{{.Names}}",
  "{{.Image}}",
  "{{.State}}",
  "{{.Status}}",
  "{{.Ports}}",
  '{{.Label "com.docker.compose.project"}}',
  '{{.Label "com.docker.compose.service"}}',
  '{{.Label "com.docker.compose.project.working_dir"}}',
].join("\t");

export type OverviewContainer = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  kind: StateKind;
  /** Up and doing something: what "stop" acts on. */
  running: boolean;
  ports: string;
  composeProject: string;
  service: string;
  workingDir: string;
};

export function parseOverview(output: string): OverviewContainer[] {
  return output
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [id = "", name = "", image = "", state = "", status = "", ports = "", composeProject = "", service = "", workingDir = ""] = line.split("\t");
      return {
        id,
        name,
        image,
        state,
        status,
        kind: classifyStatus(state, status),
        running: state === "running" || state === "restarting" || state === "paused",
        ports,
        composeProject,
        service,
        workingDir,
      };
    });
}

export type OverviewProject = { id: number; name: string; path: string };

export type ContainerGroup = {
  /** Stable across reads: the project's id, the compose project's name, or the loose ones. */
  key: string;
  label: string;
  projectId: number | null;
  containers: OverviewContainer[];
};

/**
 * By registered project first (the deepest folder holding the compose file), then by compose
 * project, then the containers started by hand. Groups with something running come first.
 */
export function groupContainers(containers: OverviewContainer[], projects: OverviewProject[]): ContainerGroup[] {
  const groups = new Map<string, ContainerGroup>();
  for (const container of containers) {
    const owner = container.workingDir
      ? projects
          .filter(({ path }) => container.workingDir === path || container.workingDir.startsWith(`${path}/`))
          .sort((a, b) => b.path.length - a.path.length)[0]
      : undefined;
    const key = owner ? `project:${owner.id}` : container.composeProject ? `compose:${container.composeProject}` : "loose";
    const group = groups.get(key) ?? { key, label: owner?.name ?? container.composeProject, projectId: owner?.id ?? null, containers: [] };
    group.containers.push(container);
    groups.set(key, group);
  }
  const rank = (kind: StateKind) => STATE_ORDER.indexOf(kind);
  for (const group of groups.values()) {
    group.containers.sort((a, b) => Number(b.running) - Number(a.running) || rank(a.kind) - rank(b.kind) || a.name.localeCompare(b.name));
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(b.containers.some(({ running }) => running)) - Number(a.containers.some(({ running }) => running)) ||
      Number(a.key === "loose") - Number(b.key === "loose") ||
      a.label.localeCompare(b.label, "fr"),
  );
}

export type OverviewAction = "start" | "stop" | "restart";

/**
 * The ids the browser asked for, kept only if Docker still lists them and the action makes
 * sense for them: stopping one that is stopped, or starting one that runs, is skipped.
 */
export function idsToAct(action: OverviewAction, asked: string[], containers: OverviewContainer[]): string[] {
  const wanted = new Set(asked);
  return containers
    .filter(({ id }) => wanted.has(id))
    .filter(({ running }) => (action === "start" ? !running : running))
    .map(({ id }) => id);
}
