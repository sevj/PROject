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
  scanError: string | null;
};

export type RegistryView = "all" | "dirty" | "nogit" | "folders" | "errors" | "missing";
export type RegistrySort = "commit" | "name" | "dirty";

const DAY = 24 * 3600 * 1000;

const VIEW_TESTS: Record<RegistryView, (row: RegistryRow) => boolean> = {
  all: (row) => !row.missing && row.kind === "project",
  dirty: (row) => !row.missing && (row.dirtyCount ?? 0) > 0,
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
  commit: (a, b) => (b.lastCommitAt ?? -1) - (a.lastCommitAt ?? -1),
};

export function selectRows(
  rows: RegistryRow[],
  { view, query, sort }: { view: RegistryView; query: string; sort: RegistrySort },
): RegistryRow[] {
  const needle = query.trim().toLowerCase();
  return rows
    .filter(VIEW_TESTS[view])
    .filter((row) => !needle || row.path.toLowerCase().includes(needle))
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
