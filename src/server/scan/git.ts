import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mapLimit } from "./limit";

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
  lastCommitAuthor: string | null;
  firstCommitAt: Date | null;
  branchCount: number;
  stashCount: number;
  /** Commits of the local branches that no known remote branch has. Null when it cannot be told. */
  unpushedCount: number | null;
  /** Null when it cannot be told. */
  remoteCount: number | null;
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

function countLines(output: string | undefined): number {
  return (output ?? "").split("\n").filter(Boolean).length;
}

/** Null when the moment is out of range. The last bucket is the current week. */
function weekIndex(timestamp: number, nowSeconds: number, count: number): number | null {
  const age = Math.floor((nowSeconds - timestamp) / WEEK_SECONDS);
  return age >= 0 && age < count ? count - 1 - age : null;
}

/** Oldest week first; the last bucket is the current week. */
export function bucketWeeks(timestamps: number[], nowSeconds: number): number[] {
  const weeks = Array<number>(ACTIVITY_WEEKS).fill(0);
  for (const timestamp of timestamps) {
    const index = weekIndex(timestamp, nowSeconds, ACTIVITY_WEEKS);
    if (index !== null) weeks[index] += 1;
  }
  return weeks;
}

/** Throws when the repository cannot be read at all, for instance with dubious ownership. */
export async function readGitFacts(path: string, now = new Date()): Promise<GitFacts> {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const status = parseStatus(await git(path, ["status", "--porcelain=v2", "--branch"]));

  const [last, count, remote, recent, roots, branches, stashes, unpushed, remotes] = await Promise.all([
    gitOptional(path, ["log", "-1", "--format=%ct%x00%an%x00%s"]),
    gitOptional(path, ["rev-list", "--count", "HEAD"]),
    gitOptional(path, ["remote", "get-url", "origin"]),
    gitOptional(path, ["log", `--since=${nowSeconds - ACTIVITY_WEEKS * WEEK_SECONDS}`, "--format=%ct"]),
    // A history can have several roots, after a merge of unrelated repositories.
    gitOptional(path, ["log", "--max-parents=0", "--format=%ct", "HEAD"]),
    gitOptional(path, ["for-each-ref", "--format=%(refname)", "refs/heads"]),
    gitOptional(path, ["stash", "list"]),
    // The gap with the upstream says nothing of a branch without one, or of the other branches.
    gitOptional(path, ["rev-list", "--count", "--branches", "--not", "--remotes"]),
    gitOptional(path, ["remote"]),
  ]);

  const [lastTimestamp, lastAuthor, lastSubject] = last?.trimEnd().split("\0") ?? [];
  const rootTimestamps = (roots ?? "").split("\n").filter(Boolean).map(Number);

  return {
    ...status,
    remoteUrl: remote ? sanitizeRemoteUrl(remote) : null,
    commitCount: count ? Number(count.trim()) : 0,
    lastCommitAt: lastTimestamp ? new Date(Number(lastTimestamp) * 1000) : null,
    lastCommitSubject: lastSubject ?? null,
    lastCommitAuthor: lastAuthor ?? null,
    firstCommitAt: rootTimestamps.length > 0 ? new Date(Math.min(...rootTimestamps) * 1000) : null,
    branchCount: countLines(branches),
    stashCount: countLines(stashes),
    unpushedCount: unpushed === undefined ? null : Number(unpushed.trim()),
    remoteCount: remotes === undefined ? null : countLines(remotes),
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

export const HISTORY_WEEKS = 52;
/** One color each, in a fixed order. The others share a neutral one. */
export const MAX_NAMED_AUTHORS = 7;
const COMMIT_PAGE = 30;
const CHANGE_LIMIT = 200;
/** One huge file, such as a lockfile, must not hide the others. */
const MAX_FILE_PATCH_CHARS = 200_000;
const MAX_COMMIT_PATCH_CHARS = 2_000_000;
const TAG_LIMIT = 30;
const BRANCH_LIMIT = 100;

export type AuthorHistory = {
  /** Null gathers the authors beyond MAX_NAMED_AUTHORS. */
  name: string | null;
  /** How many people this line stands for. */
  people: number;
  /** All three are oldest week first, over HISTORY_WEEKS. */
  commits: number[];
  insertions: number[];
  deletions: number[];
};

export type CommitDetail = {
  hash: string;
  at: number;
  author: string;
  subject: string;
  tags: string[];
  insertions: number;
  deletions: number;
};

export type BranchDetail = {
  name: string;
  current: boolean;
  /** Whether its last commit is already part of HEAD. */
  merged: boolean;
  at: number | null;
  subject: string;
  upstream: string | null;
  /** The upstream is configured, but it no longer exists on the remote. */
  upstreamGone: boolean;
  ahead: number;
  behind: number;
  /** Can be proposed for clean-up: see `parseBranches`. */
  removable: boolean;
  hash: string;
  /** Commits it has and the main branch lacks, and the reverse. Null without a known main branch. */
  baseAhead: number | null;
  baseBehind: number | null;
};

export type ChangedFile = {
  path: string;
  /** Where a renamed file comes from. */
  from: string | null;
  state: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflict";
};

export type StashEntry = { ref: string; at: number | null; branch: string | null; message: string };

export type RemoteBranch = { name: string; at: number | null; author: string; subject: string };

export type CommitFileStat = {
  path: string;
  /** Null for a binary file. */
  insertions: number | null;
  deletions: number | null;
};

export type CommitFile = CommitFileStat & {
  /** Null when it could not be read or is beyond what a commit can show. */
  patch: string | null;
  truncated: boolean;
};

export type CommitView = {
  hash: string;
  at: number;
  author: string;
  subject: string;
  body: string;
  /** A merge is shown against the branch it was merged into. */
  isMerge: boolean;
  files: CommitFile[];
};

export type TagDetail = { name: string; hash: string; at: number | null; subject: string };

/** What is known without comparing any file, so at once. */
export type AuthorCommits = Pick<AuthorHistory, "name" | "people" | "commits">;

export type UnpushedCommit = { hash: string; at: number | null; subject: string };
export type UnpushedBranch = { branch: string; commits: UnpushedCommit[] };
/** `total` also counts the commits beyond the ones listed. */
export type Unpushed = { total: number; branches: UnpushedBranch[] };

export type GitDetails = {
  authors: AuthorCommits[];
  /** Comparing a year of commits takes seconds on some repositories: it must not hold the page. */
  lines: Promise<AuthorHistory[]>;
  commits: CommitDetail[];
  hasMoreCommits: boolean;
  branches: BranchDetail[];
  branchCount: number;
  /** What the branches are compared to. */
  compareBase: string | null;
  changes: ChangedFile[];
  stashes: StashEntry[];
  remotes: string[];
  unpushed: Unpushed;
  /** On a remote, without any local branch for them. */
  remoteBranches: RemoteBranch[];
  remoteBranchCount: number;
  /** Not limited like `branches`: the clean-up must offer all of them. */
  removable: BranchDetail[];
  /** Read when the tab opens, since the last refresh may be old and this decides what can be done. */
  dirtyCount: number;
  /** What stops a change of branch. */
  trackedChangeCount: number;
  tags: TagDetail[];
  tagCount: number;
  /** Who moved which branch lately, local and remote ones together. */
  workers: Worker[];
};

type LogRecord = { fields: string[]; insertions: number; deletions: number };

/** For a `git log` whose format starts with %x01, with --shortstat. */
export function parseLog(output: string): LogRecord[] {
  return output
    .split("\x01")
    .slice(1)
    .map((record) => {
      const end = record.indexOf("\n");
      const stat = end === -1 ? "" : record.slice(end);
      return {
        fields: (end === -1 ? record : record.slice(0, end)).split("\0"),
        insertions: Number(/(\d+) insertions?\(\+\)/.exec(stat)?.[1] ?? 0),
        deletions: Number(/(\d+) deletions?\(-\)/.exec(stat)?.[1] ?? 0),
      };
    });
}

/** The most active authors first, which is what keeps their color from one period to another. */
export function buildAuthorHistory(records: LogRecord[], nowSeconds: number): AuthorHistory[] {
  const byAuthor = new Map<string, AuthorHistory>();
  for (const { fields, insertions, deletions } of records) {
    const [timestamp, name] = fields;
    const index = weekIndex(Number(timestamp), nowSeconds, HISTORY_WEEKS);
    if (index === null) continue;
    // The same person often commits as both "Sevj" and "sevj". The most recent spelling stays.
    const key = name.toLowerCase();
    let author = byAuthor.get(key);
    if (!author) {
      const empty = () => Array<number>(HISTORY_WEEKS).fill(0);
      author = { name, people: 1, commits: empty(), insertions: empty(), deletions: empty() };
      byAuthor.set(key, author);
    }
    author.commits[index] += 1;
    author.insertions[index] += insertions;
    author.deletions[index] += deletions;
  }

  const total = ({ commits }: AuthorHistory) => commits.reduce((sum, count) => sum + count, 0);
  const sorted = [...byAuthor.values()].sort(
    (a, b) => total(b) - total(a) || (a.name ?? "").localeCompare(b.name ?? ""),
  );
  const rest = sorted.slice(MAX_NAMED_AUTHORS);
  if (rest.length === 0) return sorted;

  const sumOf = (key: "commits" | "insertions" | "deletions") =>
    Array.from({ length: HISTORY_WEEKS }, (_, week) => rest.reduce((sum, author) => sum + author[key][week], 0));
  return [
    ...sorted.slice(0, MAX_NAMED_AUTHORS),
    {
      name: null,
      people: rest.length,
      commits: sumOf("commits"),
      insertions: sumOf("insertions"),
      deletions: sumOf("deletions"),
    },
  ];
}

/** Long-lived by convention: being merged somewhere does not mean they are finished. */
const PROTECTED_BRANCHES = new Set([
  "main",
  "master",
  "trunk",
  "develop",
  "development",
  "dev",
  "staging",
  "preprod",
  "production",
  "prod",
  "stable",
]);

/**
 * The current branch first, then the most recently active ones as given by git.
 * A branch is removable once merged into HEAD, unless something else still relies on its
 * name: it is checked out elsewhere, or it is a main branch. With a detached HEAD, nothing
 * is: being part of a lone commit says nothing about what is finished.
 */
export function parseBranches(output: string, merged: string, defaultBranch: string | null = null): BranchDetail[] {
  const mergedNames = new Set(merged.split("\n").filter(Boolean));
  const lines = output.split("\n").filter(Boolean).map((line) => line.split("\0"));
  const attached = lines.some(([, head]) => head === "*");
  const branches = lines.map(([name, head, upstream, track, timestamp, worktree, subject, hash]) => {
    const current = head === "*";
    const isMerged = mergedNames.has(name);
    return {
      name,
      current,
      merged: isMerged,
      at: timestamp ? Number(timestamp) * 1000 : null,
      subject: subject ?? "",
      upstream: upstream || null,
      upstreamGone: track === "gone",
      ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
      behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
      removable:
        attached && isMerged && !current && !worktree && !PROTECTED_BRANCHES.has(name) && name !== defaultBranch,
      hash: hash ?? "",
      baseAhead: null,
      baseBehind: null,
    };
  });
  return branches.sort((x, y) => Number(y.current) - Number(x.current));
}

export async function readBranches(path: string): Promise<BranchDetail[]> {
  const [branches, merged, remoteHead] = await Promise.all([
    gitOptional(path, [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname:strip=2)%00%(HEAD)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(committerdate:unix)%00%(worktreepath)%00%(contents:subject)%00%(objectname:short)",
      "refs/heads",
    ]),
    gitOptional(path, ["for-each-ref", "--merged=HEAD", "--format=%(refname:strip=2)", "refs/heads"]),
    remoteHeadOf(path),
  ]);
  return parseBranches(branches ?? "", merged ?? "", remoteHead);
}

const remoteHeadOf = async (path: string) =>
  (await gitOptional(path, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]))?.trim().replace(/^origin\//, "") || null;

/** The branch others are compared to: the one the remote calls its default, or the usual names. */
export function pickCompareBase(names: string[], remoteHead: string | null): string | null {
  const known = new Set(names);
  return [remoteHead, "main", "master", "trunk", "develop"].find((name) => name && known.has(name)) ?? null;
}

/** Git 2.41 at least: with an older one the branches are just shown without this. */
async function readBranchesCompared(path: string): Promise<{ branches: BranchDetail[]; base: string | null }> {
  const [branches, remoteHead] = await Promise.all([readBranches(path), remoteHeadOf(path)]);
  const base = pickCompareBase(branches.map(({ name }) => name), remoteHead);
  if (!base) return { branches, base };
  const output = await gitOptional(path, [
    "for-each-ref",
    `--format=%(refname:strip=2)%00%(ahead-behind:refs/heads/${base})`,
    "refs/heads",
  ]);
  if (output === undefined) return { branches, base: null };
  const gaps = new Map(
    output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, gap] = line.split("\0");
        return [name, gap.split(" ").map(Number)] as const;
      }),
  );
  return {
    base,
    branches: branches.map((branch) => {
      const gap = gaps.get(branch.name);
      return gap && branch.name !== base ? { ...branch, baseAhead: gap[0], baseBehind: gap[1] } : branch;
    }),
  };
}

/** From `git status --porcelain=v1 -z`, where a rename is followed by the name it had. */
export function parseChanges(output: string): ChangedFile[] {
  const tokens = output.split("\0").filter(Boolean);
  const files: ChangedFile[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const [x, y] = tokens[index];
    const path = tokens[index].slice(3);
    const code = `${x}${y}`;
    const renamed = x === "R" || x === "C" || y === "R" || y === "C";
    const from = renamed ? (tokens[(index += 1)] ?? null) : null;
    let state: ChangedFile["state"] = "modified";
    if (code === "??") state = "untracked";
    else if (code.includes("U") || code === "AA" || code === "DD") state = "conflict";
    else if (renamed) state = "renamed";
    else if (code.includes("D")) state = "deleted";
    else if (code.includes("A")) state = "added";
    files.push({ path, from, state });
  }
  return files;
}

const UNPUSHED_LIMIT = 100;

/** For a `git log --source`, which names one branch per commit even when several hold it. */
export function parseUnpushed(output: string): UnpushedBranch[] {
  const branches = new Map<string, UnpushedCommit[]>();
  for (const line of output.split("\n").filter(Boolean)) {
    const [source, hash, timestamp, subject] = line.split("\0");
    const branch = source.replace(/^refs\/heads\//, "");
    const commit = { hash, at: timestamp ? Number(timestamp) * 1000 : null, subject: subject ?? "" };
    branches.set(branch, [...(branches.get(branch) ?? []), commit]);
  }
  return [...branches].map(([branch, commits]) => ({ branch, commits }));
}

async function readUnpushed(path: string): Promise<Unpushed> {
  const range = ["--branches", "--not", "--remotes"];
  const [count, log] = await Promise.all([
    gitOptional(path, ["rev-list", "--count", ...range]),
    gitOptional(path, ["log", "--source", `--max-count=${UNPUSHED_LIMIT}`, "--format=%S%x00%h%x00%ct%x00%s", ...range]),
  ]);
  return { total: Number(count?.trim() ?? 0), branches: parseUnpushed(log ?? "") };
}

/** `On main: message`, or `WIP on main: abc123 subject` when no message was given. */
export function parseStashes(output: string): StashEntry[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, timestamp, summary] = line.split("\0");
      const match = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(summary ?? "");
      return {
        ref,
        at: timestamp ? Number(timestamp) * 1000 : null,
        branch: match?.[1] ?? null,
        message: match?.[2] ?? summary ?? "",
      };
    });
}

/** Leaves out what is already there locally, under the same name or as an upstream. */
export function parseRemoteBranches(output: string, locals: BranchDetail[]): RemoteBranch[] {
  const names = new Set(locals.map(({ name }) => name));
  const upstreams = new Set(locals.flatMap(({ upstream }) => upstream ?? []));
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\0"))
    .filter(([name, symref]) => !symref && !upstreams.has(name) && !names.has(name.slice(name.indexOf("/") + 1)))
    .map(([name, , timestamp, author, subject]) => ({
      name,
      at: timestamp ? Number(timestamp) * 1000 : null,
      author: author ?? "",
      subject: subject ?? "",
    }));
}

export async function readRemoteBranches(path: string, locals: BranchDetail[]): Promise<RemoteBranch[]> {
  const output = await gitOptional(path, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:strip=2)%00%(symref)%00%(committerdate:unix)%00%(authorname)%00%(contents:subject)",
    "refs/remotes",
  ]);
  return parseRemoteBranches(output ?? "", locals);
}

/** How far back a branch still counts as being worked on. */
export const WORK_DAYS = 30;

export type WorkBranch = { name: string; at: number; subject: string; local: boolean; remote: boolean };
export type Worker = { name: string; at: number; branches: WorkBranch[] };

/**
 * From a `for-each-ref` over local and remote branches: who made the last commit of each
 * branch moved within WORK_DAYS. A branch here and on a remote under the same name is one
 * branch, credited to whoever moved it last.
 */
export function buildWorkers(output: string, nowMs: number, days = WORK_DAYS): Worker[] {
  const since = nowMs - days * 24 * 3600 * 1000;
  const branches = new Map<string, WorkBranch & { author: string }>();
  for (const line of output.split("\n").filter(Boolean)) {
    const [ref, symref, timestamp, author, subject] = line.split("\0");
    if (symref || !timestamp || !author) continue;
    const local = ref.startsWith("refs/heads/");
    const rest = ref.replace(/^refs\/(?:heads|remotes)\//, "");
    const name = local ? rest : rest.slice(rest.indexOf("/") + 1);
    const at = Number(timestamp) * 1000;
    const known = branches.get(name);
    const flags = { local: local || (known?.local ?? false), remote: !local || (known?.remote ?? false) };
    if (!known || at > known.at) branches.set(name, { name, at, subject: subject ?? "", author, ...flags });
    else branches.set(name, { ...known, ...flags });
  }
  // The same person often commits as both "Sevj" and "sevj". The most recent spelling stays.
  const people = new Map<string, Worker>();
  for (const { author, ...branch } of [...branches.values()].sort((a, b) => b.at - a.at)) {
    if (branch.at < since) continue;
    const key = author.toLowerCase();
    const person = people.get(key) ?? { name: author, at: branch.at, branches: [] };
    person.branches.push(branch);
    people.set(key, person);
  }
  return [...people.values()];
}

async function readWorkers(path: string, nowMs: number): Promise<Worker[]> {
  const output = await gitOptional(path, [
    "for-each-ref",
    "--format=%(refname)%00%(symref)%00%(committerdate:unix)%00%(authorname)%00%(contents:subject)",
    "refs/heads",
    "refs/remotes",
  ]);
  return buildWorkers(output ?? "", nowMs);
}

export type CommitPage = { commits: CommitDetail[]; hasMore: boolean };

/**
 * Starting from a given commit, so that a commit made in the meantime does not shift the
 * pages. One more than a page is read to know whether anything is left.
 */
export async function readCommits(path: string, { from, skip = 0 }: { from?: string; skip?: number } = {}): Promise<CommitPage> {
  if (from !== undefined && !COMMIT_HASH.test(from)) return { commits: [], hasMore: false };
  const output = await gitOptional(path, [
    "log",
    `-${COMMIT_PAGE + 1}`,
    `--skip=${Math.max(0, Math.floor(skip))}`,
    "--format=%x01%h%x00%ct%x00%aN%x00%D%x00%s",
    "--shortstat",
    ...(from ? [from] : []),
  ]);
  const commits = parseLog(output ?? "").map(({ fields, insertions, deletions }) => {
    const [hash, timestamp, author, refs, subject] = fields;
    return {
      hash,
      at: Number(timestamp) * 1000,
      author,
      subject,
      tags: refs
        .split(", ")
        .filter((ref) => ref.startsWith("tag: "))
        .map((ref) => ref.slice("tag: ".length)),
      insertions,
      deletions,
    };
  });
  return { commits: commits.slice(0, COMMIT_PAGE), hasMore: commits.length > COMMIT_PAGE };
}

/** A hash comes from the browser: it must not be able to read as an option or a range. */
const COMMIT_HASH = /^[0-9a-f]{4,64}$/;

export function parseNumstat(output: string): CommitFileStat[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [added, removed, ...path] = line.split("\t");
      return {
        path: path.join("\t"),
        insertions: added === "-" ? null : Number(added),
        deletions: removed === "-" ? null : Number(removed),
      };
    });
}

/** One part per file. Only a file header starts with this: lines of content have a prefix. */
export function splitPatch(patch: string): string[] {
  return patch
    .split(/^(?=diff --git )/m)
    .filter((part) => part.startsWith("diff --git "));
}

/** Git gives files in the same order in both outputs, whatever their paths look like after a rename. */
export function attachPatches(
  stats: CommitFileStat[],
  patch: string | undefined,
  { perFile = MAX_FILE_PATCH_CHARS, perCommit = MAX_COMMIT_PATCH_CHARS } = {},
): CommitFile[] {
  const parts = splitPatch(patch ?? "");
  // Never show one file's changes under the name of another.
  const usable = parts.length === stats.length;
  let budget = perCommit;
  return stats.map((stat, index) => {
    const part = usable ? parts[index] : undefined;
    if (part === undefined || budget <= 0) return { ...stat, patch: null, truncated: false };
    const shown = part.slice(0, Math.min(perFile, budget));
    budget -= shown.length;
    return { ...stat, patch: shown, truncated: shown.length < part.length };
  });
}

// What a repository configures to transform its files must not run because a page was opened.
const DIFF_OPTIONS = ["--no-color", "--no-ext-diff", "--no-textconv"];
const QUOTING = ["-c", "core.quotePath=false"];

const UNTRACKED_PATCH_LIMIT = 30;
const UNTRACKED_CONCURRENCY = 8;

/** Git has nothing to compare an untracked file with, so it is compared with nothing. */
async function readUntrackedFile(cwd: string, file: string, showPatch: boolean): Promise<CommitFile> {
  const unread = { path: file, insertions: 0, deletions: 0, patch: null, truncated: false };
  if (!showPatch) return unread;
  let patch: string;
  try {
    patch = await git(cwd, [...QUOTING, "diff", "--no-index", ...DIFF_OPTIONS, "--patch", "--", "/dev/null", file]);
  } catch (error) {
    // Finding differences is what this command exits with 1 for.
    const { code, stdout } = error as { code?: number; stdout?: string };
    if (code !== 1 || stdout === undefined) return unread;
    patch = stdout;
  }
  const firstHunk = patch.indexOf("\n@@ ");
  const added = firstHunk === -1 ? [] : patch.slice(firstHunk + 1).split("\n").filter((line) => line.startsWith("+"));
  const binary = firstHunk === -1 && patch.includes("\nBinary files ");
  return attachPatches([{ path: file, insertions: binary ? null : added.length, deletions: binary ? null : 0 }], patch)[0];
}

/** What differs from the last commit, untracked files included. Null when it cannot be read. */
export async function readWorkingDiff(path: string): Promise<CommitFile[] | null> {
  const [numstat, patch, others] = await Promise.all([
    // Fails before the first commit, when only untracked files can exist.
    gitOptional(path, [...QUOTING, "diff", ...DIFF_OPTIONS, "--numstat", "HEAD"]),
    gitOptional(path, [...QUOTING, "diff", ...DIFF_OPTIONS, "--patch", "HEAD"]),
    gitOptional(path, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  if (others === undefined) return null;
  const listed = others.split("\0").filter(Boolean).map((file, index) => ({ file, showPatch: index < UNTRACKED_PATCH_LIMIT }));
  const untracked = await mapLimit(listed, UNTRACKED_CONCURRENCY, ({ file, showPatch }) => readUntrackedFile(path, file, showPatch));
  return [...attachPatches(parseNumstat(numstat ?? ""), patch), ...untracked];
}

/** A reference comes from the browser: it must not be able to read as an option or a range. */
const STASH_REF = /^stash@\{\d{1,6}\}$/;

/** What a stash holds, which stays in place. Null when this is not one of this repository. */
export async function readStashView(path: string, ref: string): Promise<CommitFile[] | null> {
  if (!STASH_REF.test(ref)) return null;
  const show = [...QUOTING, "stash", "show", ...DIFF_OPTIONS, "--include-untracked"];
  const [numstat, patch] = await Promise.all([
    gitOptional(path, [...show, "--numstat", ref]),
    gitOptional(path, [...show, "--patch", ref]),
  ]);
  return numstat === undefined ? null : attachPatches(parseNumstat(numstat), patch);
}

/** Null when this is not a commit of this repository. */
export async function readCommitView(path: string, hash: string): Promise<CommitView | null> {
  if (!COMMIT_HASH.test(hash)) return null;
  const diff = [...DIFF_OPTIONS, "--diff-merges=first-parent", "--format="];
  const [meta, numstat, patch] = await Promise.all([
    gitOptional(path, ["log", "-1", "--format=%h%x00%ct%x00%aN%x00%p%x00%s%x00%b", hash]),
    gitOptional(path, [...QUOTING, "show", ...diff, "--numstat", hash]),
    gitOptional(path, [...QUOTING, "show", ...diff, "--patch", hash]),
  ]);
  if (meta === undefined) return null;
  const [short, timestamp, author, parents, subject, body] = meta.split("\0");
  return {
    hash: short,
    at: Number(timestamp) * 1000,
    author,
    subject,
    body: (body ?? "").trim(),
    isMerge: parents.includes(" "),
    files: attachPatches(parseNumstat(numstat ?? ""), patch),
  };
}

/** Null when it cannot be told, which must not read as a clean folder. */
export async function readRemotes(path: string): Promise<string[]> {
  const remotes = await gitOptional(path, ["remote"]);
  return (remotes ?? "").split("\n").filter(Boolean);
}

/** What a change of branch would carry along: untracked files stay out of it. */
export async function readTrackedChangeCount(path: string): Promise<number | null> {
  const status = await gitOptional(path, ["status", "--porcelain", "--untracked-files=no"]);
  return status === undefined ? null : countLines(status);
}

export function parseTags(output: string): TagDetail[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, timestamp, object, target, subject] = line.split("\0");
      // An annotated tag is an object of its own: what matters is the commit it points to.
      return { name, hash: target || object, at: timestamp ? Number(timestamp) * 1000 : null, subject: subject ?? "" };
    });
}

const historyArgs = (nowSeconds: number) => [
  "log",
  `--since=${nowSeconds - HISTORY_WEEKS * WEEK_SECONDS}`,
  "--format=%x01%ct%x00%aN",
];

/** One entry per project. For a given HEAD the commits and their diffs cannot change. */
const lineRecords = new Map<string, { head: string; records: Promise<LogRecord[] | null> }>();

/** Never rejects: without these numbers, the rest of the tab is still right. */
async function readAuthorLines(path: string, nowSeconds: number): Promise<AuthorHistory[]> {
  const head = (await gitOptional(path, ["rev-parse", "HEAD"]))?.trim();
  if (!head) return [];
  let cached = lineRecords.get(path);
  if (cached?.head !== head) {
    const records = gitOptional(path, [...historyArgs(nowSeconds), "--shortstat"]).then((output) =>
      output === undefined ? null : parseLog(output),
    );
    cached = { head, records };
    lineRecords.set(path, cached);
  }
  const records = await cached.records;
  if (records !== null) return buildAuthorHistory(records, nowSeconds);
  // A timeout, for instance: the next visit tries again.
  if (lineRecords.get(path) === cached) lineRecords.delete(path);
  return [];
}

/** Read when the Git tab opens: this is too much to read for every project at each refresh. */
export async function readGitDetails(path: string, now = new Date()): Promise<GitDetails> {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const lines = readAuthorLines(path, nowSeconds);
  const [history, firstPage, tags, { branches: allBranches, base }, status, stashes] = await Promise.all([
    gitOptional(path, historyArgs(nowSeconds)),
    readCommits(path),
    gitOptional(path, [
      "for-each-ref",
      "--sort=-creatordate",
      "--format=%(refname:strip=2)%00%(creatordate:unix)%00%(objectname:short)%00%(*objectname:short)%00%(contents:subject)",
      "refs/tags",
    ]),
    readBranchesCompared(path),
    gitOptional(path, ["status", "--porcelain=v1", "-z"]),
    gitOptional(path, ["stash", "list", "--format=%gd%x00%ct%x00%gs"]),
  ]);
  const [allRemote, remotes, unpushed, workers] = await Promise.all([
    readRemoteBranches(path, allBranches),
    readRemotes(path),
    readUnpushed(path),
    readWorkers(path, now.getTime()),
  ]);

  const allTags = parseTags(tags ?? "");
  const changes = parseChanges(status ?? "");
  return {
    authors: buildAuthorHistory(parseLog(history ?? ""), nowSeconds).map(({ name, people, commits }) => ({
      name,
      people,
      commits,
    })),
    lines,
    commits: firstPage.commits,
    hasMoreCommits: firstPage.hasMore,
    branches: allBranches.slice(0, BRANCH_LIMIT),
    branchCount: allBranches.length,
    compareBase: base,
    removable: allBranches.filter(({ removable }) => removable),
    dirtyCount: changes.length,
    trackedChangeCount: changes.filter(({ state }) => state !== "untracked").length,
    changes: changes.slice(0, CHANGE_LIMIT),
    stashes: parseStashes(stashes ?? ""),
    remotes,
    unpushed,
    remoteBranches: allRemote.slice(0, BRANCH_LIMIT),
    remoteBranchCount: allRemote.length,
    tags: allTags.slice(0, TAG_LIMIT),
    tagCount: allTags.length,
    workers,
  };
}
