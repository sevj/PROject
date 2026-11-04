import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const ACTIVITY_WEEKS = 26;
const WEEK_SECONDS = 7 * 24 * 3600;

export type GitFacts = {
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  dirtyCount: number;
  remoteUrl: string | null;
  commitCount: number;
  lastCommitAt: Date | null;
  lastCommitSubject: string | null;
  weeklyCommits: number[];
};

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd,
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
    // Without this, `git status` may rewrite .git/index: the scan must stay read-only.
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  });
  return stdout;
}

/** Undefined when the command fails, for what an empty repository legitimately lacks. */
async function gitOptional(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return await git(cwd, args);
  } catch {
    return undefined;
  }
}

export function parseStatus(output: string) {
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  let dirtyCount = 0;

  for (const line of output.split("\n")) {
    if (line === "") continue;
    if (!line.startsWith("# ")) {
      dirtyCount += 1;
    } else if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length);
      branch = head === "(detached)" ? null : head;
    } else if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length);
    } else if (line.startsWith("# branch.ab ")) {
      const match = /^\+(\d+) -(\d+)$/.exec(line.slice("# branch.ab ".length));
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    }
  }
  return { branch, upstream, ahead, behind, dirtyCount };
}

/** Remote URLs can embed a token: it must not reach the database or the screen. */
export function sanitizeRemoteUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
      return parsed.toString();
    }
  } catch {
    // scp-like syntax (git@host:owner/repo.git) is not a URL and holds no secret.
  }
  return trimmed;
}

/** Oldest week first; the last bucket is the current week. */
export function bucketWeeks(timestamps: number[], nowSeconds: number): number[] {
  const weeks = Array<number>(ACTIVITY_WEEKS).fill(0);
  for (const timestamp of timestamps) {
    const age = Math.floor((nowSeconds - timestamp) / WEEK_SECONDS);
    if (age >= 0 && age < ACTIVITY_WEEKS) {
      weeks[ACTIVITY_WEEKS - 1 - age] += 1;
    }
  }
  return weeks;
}

/** Throws when the repository cannot be read at all, for instance with dubious ownership. */
export async function readGitFacts(path: string, now = new Date()): Promise<GitFacts> {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const status = parseStatus(await git(path, ["status", "--porcelain=v2", "--branch"]));

  const [last, count, remote, recent] = await Promise.all([
    gitOptional(path, ["log", "-1", "--format=%ct%x00%s"]),
    gitOptional(path, ["rev-list", "--count", "HEAD"]),
    gitOptional(path, ["remote", "get-url", "origin"]),
    gitOptional(path, ["log", `--since=${nowSeconds - ACTIVITY_WEEKS * WEEK_SECONDS}`, "--format=%ct"]),
  ]);

  const [lastTimestamp, lastSubject] = last?.trimEnd().split("\0") ?? [];

  return {
    ...status,
    remoteUrl: remote ? sanitizeRemoteUrl(remote) : null,
    commitCount: count ? Number(count.trim()) : 0,
    lastCommitAt: lastTimestamp ? new Date(Number(lastTimestamp) * 1000) : null,
    lastCommitSubject: lastSubject ?? null,
    weeklyCommits: bucketWeeks(
      (recent ?? "").split("\n").filter(Boolean).map(Number),
      nowSeconds,
    ),
  };
}

export type RecentCommit = { at: Date; subject: string };

/** Read when a project sheet opens, since only that page needs it. */
export async function readRecentCommits(path: string, limit = 8): Promise<RecentCommit[]> {
  const output = await gitOptional(path, ["log", `-${limit}`, "--format=%ct%x00%s"]);
  return (output ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [timestamp, subject] = line.split("\0");
      return { at: new Date(Number(timestamp) * 1000), subject };
    });
}
