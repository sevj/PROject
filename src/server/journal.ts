import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, between, eq } from "drizzle-orm";
import { buildWeek, type JournalWeek, nextDay } from "@/lib/journal";
import type { Db } from "./db/client";
import { activitySamples, claudeApiCalls, projectFacts, projectMeta, projects } from "./db/schema";
import { getSettings } from "./settings";

const run = promisify(execFile);
const TIMEOUT_MS = 30_000;

/**
 * Starting a process stops the whole server for as long as it takes to copy its memory
 * map, which is a long time for a server this size: one shell goes through the
 * repositories, rather than two processes started from here for each of them.
 * `-F` takes the address as it is, whatever characters it holds.
 */
const COMMIT_MOMENTS = `
since=$1; until=$2; shift 2
index=0
for dir in "$@"; do
  echo ">$index"
  index=$((index + 1))
  cd -- "$dir" 2>/dev/null || continue
  email=$(git -c core.fsmonitor=false config user.email 2>/dev/null)
  git -c core.fsmonitor=false log --all --no-merges "--since=$since" "--until=$until" -F \${email:+"--author=$email"} --format=%at 2>/dev/null
done
`;

export function parseCommitMoments(output: string, count: number): number[][] {
  const moments: number[][] = Array.from({ length: count }, () => []);
  let current: number[] | undefined;
  for (const line of output.split("\n")) {
    if (line.startsWith(">")) current = moments[Number(line.slice(1))];
    else if (/^\d+$/.test(line) && Number(line) > 0) current?.push(Number(line) * 1000);
  }
  return moments;
}

/** When the user wrote commits in each repository: author dates, merges left out. */
export async function readCommitMoments(paths: string[], fromMs: number, toMs: number): Promise<number[][]> {
  if (paths.length === 0) return [];
  const args = ["-c", COMMIT_MOMENTS, "sh", new Date(fromMs).toISOString(), new Date(toMs).toISOString(), ...paths];
  try {
    const { stdout } = await run("sh", args, {
      timeout: TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    });
    return parseCommitMoments(stdout, paths.length);
  } catch (error) {
    // What was read before it stopped is still true: the rest simply shows no moments.
    return parseCommitMoments((error as { stdout?: string }).stdout ?? "", paths.length);
  }
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

  const withGit = config.commits ? rows.filter((row) => row.hasGit) : [];
  const moments = await readCommitMoments(withGit.map((row) => row.path), from, to);
  const commitsOf = new Map(withGit.map((row, index) => [row.id, moments[index]]));

  const inputs = rows.map((row) => ({
    id: row.id,
    name: row.displayName ?? row.name,
    commits: commitsOf.get(row.id) ?? [],
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
