import { getDb } from "../db/client";
import { defaultRoot, runScan, type ScanResult } from "./run";
import { runSizeScan } from "./size";

// Kept on globalThis so that a hot reload in dev does not lose a running job.
const jobs = globalThis as unknown as {
  __pmScan?: Promise<ScanResult>;
  __pmSizing?: boolean;
};

export function isSizing(): boolean {
  return jobs.__pmSizing === true;
}

export function startSizing(projectIds?: number[]) {
  if (jobs.__pmSizing) return;
  jobs.__pmSizing = true;
  runSizeScan(getDb(), projectIds)
    .catch((error) => console.error("Calcul des tailles interrompu", error))
    .finally(() => {
      jobs.__pmSizing = false;
    });
}

/** A double click or a second tab joins the running scan instead of starting another. */
export function startScan(): Promise<ScanResult> {
  jobs.__pmScan ??= runScan(getDb(), defaultRoot())
    .then((result) => {
      // Sizes take far longer than the rest, so the scan does not wait for them.
      startSizing();
      return result;
    })
    .finally(() => {
      jobs.__pmScan = undefined;
    });
  return jobs.__pmScan;
}
