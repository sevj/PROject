import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "./db/client";
import { getDb } from "./db/client";
import { activitySamples, projectFacts, projects } from "./db/schema";
import { getSettings } from "./settings";

const run = promisify(execFile);

const INTERVAL_MS = 5 * 60_000;
const RECENT_MS = 14 * 24 * 3600_000;
const KEEP_MS = 120 * 24 * 3600_000;
const MAX_FILES = 300;
const CONCURRENCY = 4;

/** The files that differ from the last commit: where work left a trace. */
export function parseStatusPaths(output: string): string[] {
  const entries = output.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    // A rename lists its old name as a separate entry, which is no longer on the disk.
    if (entry[0] === "R" || entry[0] === "C") i += 1;
  }
  return paths.slice(0, MAX_FILES);
}

const toMinute = (ms: number) => Math.floor(ms / 60_000) * 60_000;

/** Distinct minutes at which a changed file was last written, within the recent window. */
async function sampleProject(path: string, now: number): Promise<number[]> {
  let out: string;
  try {
    ({ stdout: out } = await run("git", ["-c", "core.fsmonitor=false", "status", "--porcelain", "-z", "--untracked-files=normal"], {
      cwd: path,
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    }));
  } catch {
    return [];
  }
  const minutes = new Set<number>();
  for (const relative of parseStatusPaths(out)) {
    try {
      const { mtimeMs } = await lstat(join(path, relative));
      if (now - mtimeMs < RECENT_MS && mtimeMs <= now) minutes.add(toMinute(mtimeMs));
    } catch {
      // Deleted since: nothing to date.
    }
  }
  return [...minutes];
}

/** One pass. A no-op unless the journal is set to use file activity. Writes only its own table. */
export async function sampleActivity(db: Db, now = Date.now()): Promise<number> {
  if (!getSettings(db).journal.files) return 0;
  const rows = db
    .select({ id: projects.id, path: projects.path, lastCommitAt: projectFacts.lastCommitAt, dirtyCount: projectFacts.dirtyCount })
    .from(projects)
    .innerJoin(projectFacts, eq(projectFacts.projectId, projects.id))
    .where(and(eq(projects.kind, "project"), eq(projects.abandoned, false), eq(projectFacts.hasGit, true)))
    .all()
    .filter((row) => (row.dirtyCount ?? 0) > 0 || (row.lastCommitAt !== null && now - row.lastCommitAt.getTime() < RECENT_MS));

  let added = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        for (const at of await sampleProject(row.path, now)) {
          added += db.insert(activitySamples).values({ projectId: row.id, at }).onConflictDoNothing().run().changes;
        }
      }
    }),
  );
  db.delete(activitySamples).where(lt(activitySamples.at, now - KEEP_MS)).run();
  return added;
}

const holder = globalThis as unknown as { __pmActivitySampler?: boolean };

/** Runs while the app does, and does nothing at all until the setting is turned on. */
export function startActivitySampler(): void {
  if (holder.__pmActivitySampler) return;
  holder.__pmActivitySampler = true;
  const loop = async () => {
    try {
      await sampleActivity(getDb());
    } catch (error) {
      console.warn("Activity sampler: a pass failed.", error);
    }
    setTimeout(() => void loop(), INTERVAL_MS).unref();
  };
  setTimeout(() => void loop(), 30_000).unref();
}
