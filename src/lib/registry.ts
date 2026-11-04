import type { ContainerFact, ProjectStatus, VersionFact } from "@/server/db/schema";

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Actif",
  paused: "En pause",
  resume: "À reprendre",
};

export type RegistryRow = {
  id: number;
  /** The name chosen by the user, or else the folder's. */
  name: string;
  folderName: string;
  path: string;
  /** Inside its multi-project, null for a project on its own. */
  subdirectory: string | null;
  parentId: number | null;
  parentName: string | null;
  parentFolderName: string | null;
  parentPath: string | null;
  parentDescription: string | null;
  parentMissing: boolean;
  /** Measured on the parent folder itself, so it counts the files outside any project. */
  parentSizeBytes: number | null;
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
  branchCount: number | null;
  stashCount: number | null;
  firstCommitAt: number | null;
  lastCommitAuthor: string | null;
  lastCommitAt: number | null;
  lastCommitSubject: string | null;
  weeklyCommits: number[] | null;
  hasCompose: boolean;
  containers: ContainerFact[];
  sizeBytes: number | null;
  depsBytes: number | null;
  gitBytes: number | null;
  versions: VersionFact[];
  packageManagers: string[];
  ci: string[];
  testTools: string[];
  docs: string[];
  envFiles: string[];
  manifestDescription: string | null;
  description: string | null;
  scanError: string | null;
  ideLabel: string;
  status: ProjectStatus | null;
  favorite: boolean;
  note: string | null;
  abandoned: boolean;
  tags: string[];
};

export type RegistryView = "all" | "abandoned";
export type RegistrySort = "commit" | "name" | "dirty" | "size";

export function runningCount(row: RegistryRow): number {
  return row.containers.filter((container) => container.state === "running").length;
}

export function dockerLabel(row: RegistryRow): string {
  const running = runningCount(row);
  if (running > 0) return `${running} up`;
  return row.hasCompose || row.containers.length > 0 ? "arrêté" : "—";
}

const VIEW_TESTS: Record<RegistryView, (row: RegistryRow) => boolean> = {
  // A folder that moved stays listed: only the user can point it elsewhere or remove it.
  all: (row) => !row.abandoned,
  abandoned: (row) => row.abandoned,
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
    tags = [],
    untagged = false,
  }: { view: RegistryView; query: string; sort: RegistrySort; tags?: string[]; untagged?: boolean },
): RegistryRow[] {
  const needle = query.trim().toLowerCase();
  return rows
    .filter(VIEW_TESTS[view])
    // Several tags narrow the list: a project must carry all of them.
    .filter((row) => tags.every((tag) => row.tags.includes(tag)))
    .filter((row) => !untagged || row.tags.length === 0)
    .filter(
      (row) =>
        !needle ||
        row.name.toLowerCase().includes(needle) ||
        (row.description ?? row.manifestDescription ?? "").toLowerCase().includes(needle) ||
        row.path.toLowerCase().includes(needle) ||
        row.tags.some((tag) => tag.toLowerCase().includes(needle)),
    )
    .sort((a, b) => SORTERS[sort](a, b) || a.name.localeCompare(b.name, "fr"));
}

export type ProjectGroup = {
  parentId: number;
  name: string;
  folderName: string;
  path: string;
  description: string | null;
  missing: boolean;
  rows: RegistryRow[];
  dirtyCount: number;
  running: number;
  sizeBytes: number | null;
  lastCommitAt: number | null;
  weeklyCommits: number[] | null;
};

export type RegistryItem = { kind: "project"; row: RegistryRow } | { kind: "group"; group: ProjectGroup };

function sumWeeks(rows: RegistryRow[]): number[] | null {
  const series = rows.flatMap((row) => (row.weeklyCommits ? [row.weeklyCommits] : []));
  if (series.length === 0) return null;
  return series[0].map((_, week) => series.reduce((sum, weeks) => sum + (weeks[week] ?? 0), 0));
}

function toGroup(parentId: number, rows: RegistryRow[], useFolderSize: boolean): ProjectGroup {
  const folderName = rows[0].parentFolderName ?? "Dossier parent";
  const sizes = rows.flatMap((row) => row.sizeBytes ?? []);
  const summed = sizes.length > 0 ? sizes.reduce((sum, size) => sum + size, 0) : null;
  const commits = rows.flatMap((row) => row.lastCommitAt ?? []);
  return {
    parentId,
    name: rows[0].parentName ?? folderName,
    folderName,
    path: rows[0].parentPath ?? "",
    description: rows[0].parentDescription,
    missing: rows[0].parentMissing,
    rows,
    dirtyCount: rows.reduce((sum, row) => sum + (row.dirtyCount ?? 0), 0),
    running: rows.reduce((sum, row) => sum + runningCount(row), 0),
    sizeBytes: (useFolderSize ? rows[0].parentSizeBytes : null) ?? summed,
    lastCommitAt: commits.length > 0 ? Math.max(...commits) : null,
    weeklyCommits: sumWeeks(rows),
  };
}

/**
 * Gathers the projects of a parent folder into one block, placed where its first
 * project would be: the order of `rows` decides, including inside the block.
 */
export function groupRows(rows: RegistryRow[], { useFolderSize = true } = {}): RegistryItem[] {
  const children = new Map<number, RegistryRow[]>();
  for (const row of rows) {
    if (row.parentId !== null) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
  }
  const items: RegistryItem[] = [];
  const placed = new Set<number>();
  for (const row of rows) {
    const { parentId } = row;
    if (parentId === null) {
      items.push({ kind: "project", row });
    } else if (!placed.has(parentId)) {
      placed.add(parentId);
      items.push({ kind: "group", group: toGroup(parentId, children.get(parentId) ?? [], useFolderSize) });
    }
  }
  return items;
}

export function countTags(rows: RegistryRow[], view: RegistryView) {
  const inView = rows.filter(VIEW_TESTS[view]);
  const counts = new Map<string, number>();
  for (const row of inView) {
    for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return { counts, untagged: inView.filter((row) => row.tags.length === 0).length };
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
