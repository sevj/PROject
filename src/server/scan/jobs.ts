import { getDb } from "../db/client";
import { refreshAll, type RefreshResult } from "./run";
import { runSizeScan } from "./size";

// Kept on globalThis so that a hot reload in dev does not lose a running job.
const jobs = globalThis as unknown as {
  __pmRefresh?: Promise<RefreshResult>;
  __pmSizing?: boolean;
  /** Asked for while a measure was running. `all` wins over a list of projects. */
  __pmSizingQueue?: number[] | "all";
};

export function isSizing(): boolean {
  return jobs.__pmSizing === true;
}

/** Adding several projects in a row must measure each of them, not only the first. */
export function startSizing(projectIds?: number[]) {
  if (jobs.__pmSizing) {
    const queued = jobs.__pmSizingQueue;
    jobs.__pmSizingQueue =
      !projectIds || queued === "all" ? "all" : [...(queued ?? []), ...projectIds];
    return;
  }
  jobs.__pmSizing = true;
  runSizeScan(getDb(), projectIds)
    .catch((error) => console.error("Calcul des tailles interrompu", error))
    .finally(() => {
      jobs.__pmSizing = false;
      const queued = jobs.__pmSizingQueue;
      jobs.__pmSizingQueue = undefined;
      if (queued) startSizing(queued === "all" ? undefined : queued);
    });
}

/** A double click or a second tab joins the running refresh instead of starting another. */
export function startRefresh(): Promise<RefreshResult> {
  jobs.__pmRefresh ??= refreshAll(getDb())
    .then((result) => {
      // Sizes take far longer than the rest, so the refresh does not wait for them.
      startSizing();
      return result;
    })
    .finally(() => {
      jobs.__pmRefresh = undefined;
    });
  return jobs.__pmRefresh;
}
