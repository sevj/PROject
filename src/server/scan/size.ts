import { execFile } from "node:child_process";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { projectFacts, projects } from "../db/schema";
import { mapLimit } from "./limit";

const SIZE_CONCURRENCY = 4;
const EXCLUDED = ["node_modules", "vendor", "target"];

export function parseDuOutput(output: string): number | null {
  const size = Number.parseInt(output, 10);
  return Number.isNaN(size) ? null : size;
}

/** Disk usage without regenerable dependencies. Null when it could not be measured. */
export function readSize(path: string): Promise<number | null> {
  const args = ["-s", "--block-size=1", ...EXCLUDED.map((name) => `--exclude=${name}`), path];
  return new Promise((resolve) => {
    execFile("du", args, { timeout: 180_000 }, (error, stdout) => {
      // du exits with 1 on a root-owned subfolder (Docker volumes) and still prints
      // its total. A timeout kills it first, and then stdout is empty.
      resolve(error && error.killed ? null : parseDuOutput(stdout));
    });
  });
}

export async function runSizeScan(db: Db, projectIds?: number[]): Promise<void> {
  const targets = db
    .select({ id: projects.id, path: projects.path })
    .from(projects)
    .where(
      and(
        isNull(projects.missingAt),
        inArray(projects.kind, ["project", "folder"]),
        projectIds ? inArray(projects.id, projectIds) : undefined,
      ),
    )
    .all();

  await mapLimit(targets, SIZE_CONCURRENCY, async ({ id, path }) => {
    const sizeBytes = await readSize(path);
    db.update(projectFacts)
      .set({ sizeBytes, sizeScannedAt: new Date() })
      .where(eq(projectFacts.projectId, id))
      .run();
  });
}
