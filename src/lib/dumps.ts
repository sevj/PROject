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
