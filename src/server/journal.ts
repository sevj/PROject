import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, between, eq } from "drizzle-orm";
import { buildWeek, type JournalWeek, nextDay } from "@/lib/journal";
import type { Db } from "./db/client";
import { activitySamples, claudeApiCalls, projectFacts, projectMeta, projects } from "./db/schema";
import { getSettings } from "./settings";

const run = promisify(execFile);
const CONCURRENCY = 8;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd,
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  });
  return stdout;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** When the user wrote commits in this repository: author dates, merges left out. */
export async function readCommitMoments(path: string, fromMs: number, toMs: number): Promise<number[]> {
  try {
    const email = (await git(path, ["config", "user.email"]).catch(() => "")).trim();
    const out = await git(path, [
      "log",
      "--all",
      "--no-merges",
      `--since=${new Date(fromMs).toISOString()}`,
      `--until=${new Date(toMs).toISOString()}`,
      ...(email ? [`--author=${escapeRegex(email)}`] : []),
      "--format=%at",
    ]);
    return out
      .split("\n")
      .map((line) => Number(line.trim()) * 1000)
      .filter((moment) => Number.isFinite(moment) && moment > 0);
  } catch {
    // Not a repository, or one that cannot be read: no moments from it.
    return [];
  }
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]);
      }
    }),
  );
  return results;
}

/** Read when asked: nothing of it is kept apart from the optional file samples. */
export async function readJournal(db: Db, weekStart: number): Promise<JournalWeek> {
  const config = getSettings(db).journal;
  // A stretch of work can begin the evening before the week, or end the morning after.
  const dayBefore = new Date(weekStart).setDate(new Date(weekStart).getDate() - 1);
  let weekEnd = weekStart;
  for (let i = 0; i < 7; i += 1) weekEnd = nextDay(weekEnd);
  const from = dayBefore;
  const to = nextDay(weekEnd);

  const rows = db
    .select({ id: projects.id, name: projects.name, displayName: projectMeta.displayName, path: projects.path, hasGit: projectFacts.hasGit })
    .from(projects)
    .leftJoin(projectFacts, eq(projectFacts.projectId, projects.id))
    .leftJoin(projectMeta, eq(projectMeta.projectId, projects.id))
    .where(and(eq(projects.kind, "project"), eq(projects.abandoned, false)))
    .all();

  const inputs = await mapLimit(rows, CONCURRENCY, async (row) => ({
    id: row.id,
    name: row.displayName ?? row.name,
    commits: config.commits && row.hasGit ? await readCommitMoments(row.path, from, to) : [],
    claude: config.claude
      ? db
          .select({ at: claudeApiCalls.calledAt })
          .from(claudeApiCalls)
          .where(and(eq(claudeApiCalls.projectId, row.id), between(claudeApiCalls.calledAt, new Date(from), new Date(to))))
          .all()
          .map(({ at }) => at.getTime())
      : [],
    files: config.files
      ? db
          .select({ at: activitySamples.at })
          .from(activitySamples)
          .where(and(eq(activitySamples.projectId, row.id), between(activitySamples.at, from, to)))
          .all()
          .map(({ at }) => at)
      : [],
  }));
  return buildWeek(weekStart, config, inputs);
}
