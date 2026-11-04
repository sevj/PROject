import type { Engine } from "./db-engines";

/** A dump of the stash as the browser sees it: no path of the machine, and dates as numbers. */
export type DumpRow = {
  id: number;
  projectId: number | null;
  projectName: string;
  containerName: string;
  engine: Engine;
  /** Null when every database of the server was dumped. */
  database: string | null;
  fileName: string;
  sizeBytes: number | null;
  rawBytes: number | null;
  status: "running" | "done" | "failed" | "cancelled";
  error: string | null;
  note: string | null;
  createdAt: number;
};

/** In UTC, so that the server and the browser always write the same thing. */
export const formatStamp = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export type ProgressInput = {
  status: "running" | "done" | "failed" | "cancelled";
  processedBytes: number;
  totalBytes: number | null;
  startedAt: number;
  finishedAt: number | null;
};

export type Progress = {
  /** Null when the total is not known: the bar then only says that something is going on. */
  percent: number | null;
  /** Bytes per second since the start. */
  rate: number;
  elapsedMs: number;
  remainingMs: number | null;
};

/** `now` is passed in so that the server and the client agree on what they show. */
export function progressOf(job: ProgressInput, now: number): Progress {
  const elapsedMs = Math.max(1, (job.finishedAt ?? now) - job.startedAt);
  const rate = job.processedBytes / (elapsedMs / 1000);
  const known = job.totalBytes !== null && job.totalBytes > 0;
  // Never 100 while it is still running: the last bytes are the ones that decide.
  const percent = known
    ? Math.min(job.status === "done" ? 100 : 99, Math.floor((job.processedBytes / (job.totalBytes as number)) * 100))
    : job.status === "done"
      ? 100
      : null;
  const remainingMs =
    job.status === "running" && known && rate > 0 && job.processedBytes < (job.totalBytes as number)
      ? Math.round((((job.totalBytes as number) - job.processedBytes) / rate) * 1000)
      : null;
  return { percent, rate, elapsedMs, remainingMs };
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${String(seconds % 60).padStart(2, "0")} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

type Statused = { id: string; status: string };

/** The jobs that were running at the last look and no longer are. */
export function endedSince<T extends Statused>(previous: ReadonlyMap<string, string>, jobs: T[]): T[] {
  return jobs.filter((job) => previous.get(job.id) === "running" && job.status !== "running");
}

/** Share of the work done across the running jobs whose total is known, or null when none is. */
export function overallPercent(jobs: { status: string; processedBytes: number; totalBytes: number | null }[]): number | null {
  const known = jobs.filter((job) => job.status === "running" && job.totalBytes !== null && job.totalBytes > 0);
  if (known.length === 0) return null;
  const total = known.reduce((sum, job) => sum + (job.totalBytes as number), 0);
  const done = known.reduce((sum, job) => sum + Math.min(job.processedBytes, job.totalBytes as number), 0);
  return Math.min(99, Math.floor((done / total) * 100));
}

export type ProjectDumps = {
  key: string;
  projectId: number | null;
  projectName: string;
  dumps: DumpRow[];
  /** Of the finished dumps only. */
  totalBytes: number;
  lastAt: number;
};

/** One group per project, the one with the latest dump first. A project removed since keeps its name. */
export function groupByProject(dumps: DumpRow[], projects: { id: number; name: string }[] = []): ProjectDumps[] {
  const groups = new Map<string, ProjectDumps>();
  // Projects with a database but no dump yet still get their place, to dump from.
  for (const { id, name } of projects) {
    groups.set(`id:${id}`, { key: `id:${id}`, projectId: id, projectName: name, dumps: [], totalBytes: 0, lastAt: 0 });
  }
  for (const dump of dumps) {
    const key = dump.projectId === null ? `name:${dump.projectName}` : `id:${dump.projectId}`;
    const group = groups.get(key) ?? { key, projectId: dump.projectId, projectName: dump.projectName, dumps: [], totalBytes: 0, lastAt: 0 };
    group.dumps.push(dump);
    group.totalBytes += dump.status === "done" ? (dump.sizeBytes ?? 0) : 0;
    group.lastAt = Math.max(group.lastAt, dump.createdAt);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.lastAt - a.lastAt || a.projectName.localeCompare(b.projectName));
}
