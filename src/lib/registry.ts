import type { ContainerFact, ProjectStatus } from "@/server/db/schema";

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Actif",
  paused: "En pause",
  resume: "À reprendre",
  archived: "Archivé",
};

export type RegistryRow = {
  id: number;
  name: string;
  path: string;
  parentName: string | null;
  kind: "project" | "folder";
  missing: boolean;
  stacks: string[];
  hasGit: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  dirtyCount: number | null;
  remoteUrl: string | null;
  commitCount: number | null;
  lastCommitAt: number | null;
  lastCommitSubject: string | null;
  weeklyCommits: number[] | null;
  hasCompose: boolean;
  containers: ContainerFact[];
  sizeBytes: number | null;
  scanError: string | null;
  ideLabel: string;
  status: ProjectStatus | null;
  favorite: boolean;
  note: string | null;
  collectionIds: number[];
  tags: string[];
};

export type RegistryView = "all" | "favorites" | "unclassified" | "dirty" | "docker" | "nogit" | "folders" | "errors" | "missing";
export type RegistrySort = "commit" | "name" | "dirty" | "size";

const DAY = 24 * 3600 * 1000;

export function runningCount(row: RegistryRow): number {
  return row.containers.filter((container) => container.state === "running").length;
}

const VIEW_TESTS: Record<RegistryView, (row: RegistryRow) => boolean> = {
  all: (row) => !row.missing && row.kind === "project",
  favorites: (row) => !row.missing && row.favorite,
  unclassified: (row) => !row.missing && row.kind === "project" && row.collectionIds.length === 0,
  dirty: (row) => !row.missing && (row.dirtyCount ?? 0) > 0,
  docker: (row) => !row.missing && runningCount(row) > 0,
  nogit: (row) => !row.missing && row.kind === "project" && !row.hasGit,
  folders: (row) => !row.missing && row.kind === "folder",
  errors: (row) => !row.missing && row.scanError !== null,
  missing: (row) => row.missing,
};

export function countView(rows: RegistryRow[], view: RegistryView): number {
  return rows.filter(VIEW_TESTS[view]).length;
}

const SORTERS: Record<RegistrySort, (a: RegistryRow, b: RegistryRow) => number> = {
  name: () => 0,
  dirty: (a, b) => (b.dirtyCount ?? -1) - (a.dirtyCount ?? -1),
  size: (a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1),
  commit: (a, b) => (b.lastCommitAt ?? -1) - (a.lastCommitAt ?? -1),
};

export function selectRows(
  rows: RegistryRow[],
  {
    view,
    query,
    sort,
    collectionId = null,
  }: { view: RegistryView; query: string; sort: RegistrySort; collectionId?: number | null },
): RegistryRow[] {
  const needle = query.trim().toLowerCase();
  return rows
    .filter(VIEW_TESTS[view])
    .filter((row) => collectionId === null || row.collectionIds.includes(collectionId))
    .filter(
      (row) =>
        !needle ||
        row.path.toLowerCase().includes(needle) ||
        row.tags.some((tag) => tag.toLowerCase().includes(needle)),
    )
    .sort((a, b) => SORTERS[sort](a, b) || a.name.localeCompare(b.name, "fr"));
}

export function computeStats(rows: RegistryRow[], now: number) {
  const projects = rows.filter(VIEW_TESTS.all);
  const age = (row: RegistryRow) => (row.lastCommitAt === null ? Infinity : now - row.lastCommitAt);
  return {
    projects: projects.length,
    git: projects.filter((row) => row.hasGit).length,
    dirty: projects.filter((row) => (row.dirtyCount ?? 0) > 0).length,
    active30: projects.filter((row) => age(row) <= 30 * DAY).length,
    dormant: projects.filter((row) => row.lastCommitAt !== null && age(row) > 365 * DAY).length,
    running: projects.reduce((sum, row) => sum + runningCount(row), 0),
  };
}

/** `now` is passed in so that the server and the client render the same text. */
export function formatAge(timestamp: number | null, now: number): string {
  if (timestamp === null) return "aucun";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} j`;
  if (days < 60) return `${Math.floor(days / 7)} sem.`;
  if (days < 365) return `${Math.floor(days / 30)} mois`;
  const years = Math.floor(days / 365);
  return `${years} an${years > 1 ? "s" : ""}`;
}

const SIZE_UNITS = ["o", "Ko", "Mo", "Go", "To"];

export function formatSize(bytes: number | null): string {
  if (bytes === null) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value < 10 && unit > 0 ? 1 : 0;
  return `${value.toFixed(digits).replace(".", ",")} ${SIZE_UNITS[unit]}`;
}
