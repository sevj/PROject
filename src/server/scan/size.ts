import { execFile } from "node:child_process";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { projectFacts, projects } from "../db/schema";
import { mapLimit } from "./limit";

const SIZE_CONCURRENCY = 4;
const EXCLUDED = ["node_modules", "vendor", "target"];

export function parseDuOutput(output: string): number | null {
  const size = Number.parseInt(output, 10);
  return Number.isNaN(size) ? null : size;
}

/** du reads its exclusions as patterns, so a path must not be taken for one. */
function escapePattern(path: string): string {
  return path.replace(/[\\*?[]/g, "\\$&");
}

/** Disk usage without regenerable dependencies. Null when it could not be measured. */
export function readSize(path: string, excludedPaths: string[] = []): Promise<number | null> {
  const args = [
    "-s",
    "--block-size=1",
    ...EXCLUDED.map((name) => `--exclude=${name}`),
    ...excludedPaths.map((excluded) => `--exclude=${escapePattern(excluded)}`),
    path,
  ];
  return new Promise((resolve) => {
    execFile("du", args, { timeout: 180_000 }, (error, stdout) => {
      // du exits with 1 on a root-owned subfolder (Docker volumes) and still prints
      // its total. A timeout kills it first, and then stdout is empty.
      resolve(error && error.killed ? null : parseDuOutput(stdout));
    });
  });
}

/**
 * Measures folders one by one, parent folders included: files can live directly in
 * them, outside any project. Asking for a project also refreshes its parent's total.
 */
export async function runSizeScan(db: Db, projectIds?: number[]): Promise<void> {
  const all = db
    .select({
      id: projects.id,
      path: projects.path,
      parentId: projects.parentId,
      abandoned: projects.abandoned,
      missingAt: projects.missingAt,
    })
    .from(projects)
    .all();

  let wanted: Set<number> | null = null;
  if (projectIds) {
    wanted = new Set(projectIds);
    for (const { id, parentId } of all) {
      if (parentId !== null && wanted.has(id)) wanted.add(parentId);
    }
  }

  const targets = all.filter(
    ({ id, abandoned, missingAt }) => !abandoned && missingAt === null && (wanted === null || wanted.has(id)),
  );

  await mapLimit(targets, SIZE_CONCURRENCY, async ({ id, path }) => {
    // An abandoned sub-project is never read again, not even through its parent.
    const abandonedChildren = all.filter((item) => item.parentId === id && item.abandoned).map((item) => item.path);
    const sizeBytes = await readSize(path, abandonedChildren);
    db.update(projectFacts)
      .set({ sizeBytes, sizeScannedAt: new Date() })
      .where(eq(projectFacts.projectId, id))
      .run();
  });
}
