import type { Db } from "../db/client";
import { listDatabaseContainers, publicTarget } from "./containers";
import { listJobs } from "./jobs";
import { failStaleDumps, listDumps, stashDir, toDumpRow } from "./store";

/** Everything the Dump stash page shows, read in one go. */
export async function readStash(db: Db) {
  const jobs = listJobs();
  // A dump still marked as running that no job owns was cut short by the server stopping.
  await failStaleDumps(db, stashDir(), new Set(jobs.map(({ dumpId }) => dumpId)));
  const { containers, error } = await listDatabaseContainers(db);
  return {
    dumps: listDumps(db).map(toDumpRow),
    targets: containers.map(publicTarget),
    dockerError: error,
    jobs,
    now: Date.now(),
  };
}
