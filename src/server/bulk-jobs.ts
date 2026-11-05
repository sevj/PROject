import { mapLimit } from "./scan/limit";

export type BulkKind = "fetch" | "analyze";
export type BulkFailure = { name: string; message: string };
export type BulkJob = {
  id: number;
  kind: BulkKind;
  total: number;
  done: number;
  failures: BulkFailure[];
  running: boolean;
};

// Kept on globalThis so that a hot reload in dev does not lose a running job. One at a time:
// each of these opens many connections or runs package managers side by side.
const holder = globalThis as unknown as { __pmBulkJob?: BulkJob };

export const currentBulkJob = (): BulkJob | null => (holder.__pmBulkJob ? { ...holder.__pmBulkJob } : null);

/**
 * In the background, since a request of the app waits for the one before it: the page follows
 * along instead of being held for minutes. False when another one is running.
 */
export function startBulkJob<T extends { name: string }>(
  kind: BulkKind,
  items: T[],
  limit: number,
  task: (item: T) => Promise<string | null>,
  onFinished: () => Promise<void> = async () => undefined,
): boolean {
  if (holder.__pmBulkJob?.running) return false;
  const job: BulkJob = { id: (holder.__pmBulkJob?.id ?? 0) + 1, kind, total: items.length, done: 0, failures: [], running: true };
  holder.__pmBulkJob = job;
  void mapLimit(items, limit, async (item) => {
    let message: string | null;
    try {
      message = await task(item);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    if (message) job.failures.push({ name: item.name, message });
    job.done += 1;
  })
    .then(onFinished)
    .catch((error) => console.error("Bulk job could not finish", error))
    .finally(() => {
      job.running = false;
    });
  return true;
}
