import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACTIVITY_WEEKS,
  attachPatches,
  bucketWeeks,
  buildAuthorHistory,
  HISTORY_WEEKS,
  MAX_NAMED_AUTHORS,
  parseBranches,
  parseChanges,
  parseLog,
  parseNumstat,
  parseRemoteBranches,
  parseStashes,
  pickCompareBase,
  readCommits,
  readCommitView,
  parseStatus,
  parseTags,
  readGitDetails,
  readGitFacts,
  sanitizeRemoteUrl,
  splitPatch,
} from "./git";

const WEEK = 7 * 24 * 3600;
const dirs: string[] = [];

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "pm-git-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  return dir;
}

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.test", ...args], { cwd }).toString();
}

function commit(dir: string, file: string, message: string) {
  writeFileSync(join(dir, file), message);
  git(dir, "add", file);
  git(dir, "commit", "-q", "-m", message);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("parseStatus", () => {
  it("reads the branch, the upstream and the counters", () => {
    expect(
      parseStatus(
        [
          "# branch.oid abc",
          "# branch.head feature/x",
          "# branch.upstream origin/feature/x",
          "# branch.ab +2 -1",
          "1 .M N... 100644 100644 100644 a b src/a.ts",
          "? new.txt",
          "",
        ].join("\n"),
      ),
    ).toEqual({ branch: "feature/x", upstream: "origin/feature/x", ahead: 2, behind: 1, dirtyCount: 2 });
  });

  it("has no branch when HEAD is detached", () => {
    expect(parseStatus("# branch.head (detached)\n").branch).toBeNull();
  });
});

describe("sanitizeRemoteUrl", () => {
  it("removes embedded credentials", () => {
    expect(sanitizeRemoteUrl("https://user:s3cret@gitlab.test/a/b.git\n")).toBe("https://gitlab.test/a/b.git");
    expect(sanitizeRemoteUrl("https://glpat-token@gitlab.test/a/b.git")).toBe("https://gitlab.test/a/b.git");
  });

  it("keeps scp-like and clean URLs", () => {
    expect(sanitizeRemoteUrl("git@github.com:sevj/a.git")).toBe("git@github.com:sevj/a.git");
    expect(sanitizeRemoteUrl("https://github.com/sevj/a.git")).toBe("https://github.com/sevj/a.git");
  });
});

describe("bucketWeeks", () => {
  it("puts the current week last and ignores what is out of range", () => {
    const now = 100 * WEEK;
    const weeks = bucketWeeks([now - 1, now - WEEK - 1, now - ACTIVITY_WEEKS * WEEK - 1, now + 10], now);
    expect(weeks).toHaveLength(ACTIVITY_WEEKS);
    expect(weeks[ACTIVITY_WEEKS - 1]).toBe(1);
    expect(weeks[ACTIVITY_WEEKS - 2]).toBe(1);
    expect(weeks.reduce((a, b) => a + b)).toBe(2);
  });
});

describe("parseLog", () => {
  it("reads the fields and the line counts of each commit", () => {
    const output = [
      "\x01100\0Ann\n\n 2 files changed, 10 insertions(+), 1 deletion(-)\n",
      "\x01200\0Bob\n\n 1 file changed, 1 insertion(+)\n",
      "\x01300\0Cid\n",
      "\x01400\0Dee",
    ].join("");
    expect(parseLog(output)).toEqual([
      { fields: ["100", "Ann"], insertions: 10, deletions: 1 },
      { fields: ["200", "Bob"], insertions: 1, deletions: 0 },
      { fields: ["300", "Cid"], insertions: 0, deletions: 0 },
      { fields: ["400", "Dee"], insertions: 0, deletions: 0 },
    ]);
  });
});

describe("buildAuthorHistory", () => {
  const now = 100 * WEEK;
  const record = (name: string, age: number, insertions = 0, deletions = 0) => ({
    fields: [String(now - age), name],
    insertions,
    deletions,
  });

  it("gives each author their weeks, the most active first", () => {
    const authors = buildAuthorHistory(
      [record("Ann", 1, 5, 2), record("Bob", 1), record("Bob", WEEK + 1, 3), record("Ann", HISTORY_WEEKS * WEEK + 1)],
      now,
    );
    expect(authors.map(({ name }) => name)).toEqual(["Bob", "Ann"]);
    expect(authors[0].commits.at(-1)).toBe(1);
    expect(authors[0].commits.at(-2)).toBe(1);
    expect(authors[0].insertions.at(-2)).toBe(3);
    expect(authors[1].commits.reduce((a, b) => a + b)).toBe(1);
    expect(authors[1].deletions.at(-1)).toBe(2);
  });

  it("counts the spellings of a name as one author", () => {
    const authors = buildAuthorHistory([record("Ann", 1), record("ann", WEEK + 1)], now);
    expect(authors).toHaveLength(1);
    expect(authors[0].name).toBe("Ann");
    expect(authors[0].commits.reduce((a, b) => a + b)).toBe(2);
  });

  it("gathers the authors beyond the named ones", () => {
    const names = Array.from({ length: MAX_NAMED_AUTHORS + 2 }, (_, index) => `A${index}`);
    const authors = buildAuthorHistory(
      names.flatMap((name, index) => Array.from({ length: names.length - index }, () => record(name, 1, 1))),
      now,
    );
    expect(authors).toHaveLength(MAX_NAMED_AUTHORS + 1);
    expect(authors.at(-1)).toMatchObject({ name: null, people: 2 });
    // The last two authors have 2 and 1 commits.
    expect(authors.at(-1)?.commits.at(-1)).toBe(3);
    expect(authors.at(-1)?.insertions.at(-1)).toBe(3);
  });
});

describe("parseBranches", () => {
  it("puts the current branch first and reads its gap with the upstream", () => {
    const output = [
      ["new", " ", "origin/new", "ahead 2, behind 1", "300", "", "Newest"],
      ["main", "*", "origin/main", "", "200", "/repo", "Main subject"],
      ["old", " ", "origin/old", "gone", "100", "", "Oldest"],
      ["local", " ", "", "", "50", "", "Local"],
    ]
      .map((fields) => fields.join("\0"))
      .join("\n");
    const branches = parseBranches(`${output}\n`, "main\nold\n");
    expect(branches.map(({ name }) => name)).toEqual(["main", "new", "old", "local"]);
    expect(branches[0]).toMatchObject({ current: true, merged: true, upstream: "origin/main", at: 200_000 });
    expect(branches[1]).toMatchObject({ current: false, merged: false, ahead: 2, behind: 1, upstreamGone: false });
    expect(branches[2]).toMatchObject({ merged: true, upstreamGone: true, ahead: 0, behind: 0 });
    expect(branches[3]).toMatchObject({ upstream: null, subject: "Local" });
  });
});

describe("parseBranches removable", () => {
  const line = (name: string, head = " ", worktree = "") => [name, head, "", "", "1", worktree, "s"].join("\0");
  const removable = (output: string[], merged: string[], defaultBranch?: string) =>
    parseBranches(output.join("\n"), merged.join("\n"), defaultBranch)
      .filter((branch) => branch.removable)
      .map(({ name }) => name);

  it("only offers merged branches, without the current one", () => {
    expect(removable([line("feat", "*"), line("done"), line("wip")], ["feat", "done"])).toEqual(["done"]);
  });

  it("keeps main branches, whatever they are merged into", () => {
    expect(removable([line("feat", "*"), line("master"), line("main"), line("develop")], ["master", "main", "develop"])).toEqual([]);
  });

  it("keeps the default branch of the remote", () => {
    expect(removable([line("feat", "*"), line("trunk2")], ["trunk2"], "trunk2")).toEqual([]);
  });

  it("keeps a branch checked out in another worktree", () => {
    expect(removable([line("feat", "*"), line("other", " ", "/elsewhere")], ["other"])).toEqual([]);
  });

  it("offers nothing with a detached HEAD", () => {
    expect(removable([line("done")], ["done"])).toEqual([]);
  });
});

describe("parseTags", () => {
  it("points an annotated tag to its commit", () => {
    expect(parseTags("v2\x00200\0abc\0def\0Second\nv1\x00100\0aaa\0\0Plain\n")).toEqual([
      { name: "v2", hash: "def", at: 200_000, subject: "Second" },
      { name: "v1", hash: "aaa", at: 100_000, subject: "Plain" },
    ]);
  });
});

describe("readGitDetails", () => {
  it("is empty for a repository without commits", async () => {
    const { lines, ...details } = await readGitDetails(tempRepo());
    expect(details).toEqual({
      authors: [],
      branches: [],
      branchCount: 0,
      compareBase: null,
      removable: [],
      dirtyCount: 0,
      trackedChangeCount: 0,
      changes: [],
      stashes: [],
      remotes: [],
      remoteBranches: [],
      remoteBranchCount: 0,
      commits: [],
      hasMoreCommits: false,
      tags: [],
      tagCount: 0,
    });
    expect(await lines).toEqual([]);
  });

  it("reads authors, commits and tags", async () => {
    const dir = tempRepo();
    commit(dir, "a.txt", "first");
    git(dir, "tag", "v1");
    commit(dir, "b.txt", "second");
    git(dir, "tag", "-a", "v2", "-m", "Second release");

    const { authors, lines, commits, tags, tagCount } = await readGitDetails(dir);
    expect(authors).toHaveLength(1);
    expect(authors[0]).toMatchObject({ name: "t", people: 1 });
    expect(authors[0].commits.at(-1)).toBe(2);
    expect(await lines).toHaveLength(1);
    expect((await lines)[0].insertions.at(-1)).toBe(2);
    expect(commits.map(({ subject }) => subject)).toEqual(["second", "first"]);
    expect(commits[0]).toMatchObject({ author: "t", tags: ["v2"], insertions: 1, deletions: 0 });
    expect(commits[1].tags).toEqual(["v1"]);
    expect(tagCount).toBe(2);
    const annotated = tags.find(({ name }) => name === "v2");
    expect(annotated?.subject).toBe("Second release");
    expect(commits[0].hash.startsWith(annotated?.hash ?? "?")).toBe(true);
  });
});

describe("readGitDetails branches", () => {
  it("tells which branches are merged and which one is current", async () => {
    const dir = tempRepo();
    commit(dir, "a.txt", "first");
    git(dir, "branch", "done");
    git(dir, "checkout", "-q", "-b", "wip");
    commit(dir, "b.txt", "wip work");
    git(dir, "checkout", "-q", "main");

    const { branches, branchCount } = await readGitDetails(dir);
    expect(branchCount).toBe(3);
    expect(branches[0]).toMatchObject({ name: "main", current: true });
    expect(branches.find(({ name }) => name === "done")).toMatchObject({ merged: true, current: false });
    expect(branches.find(({ name }) => name === "wip")).toMatchObject({ merged: false, subject: "wip work" });
  });
});

describe("parseChanges", () => {
  it("names each state and keeps the origin of a rename", () => {
    const output = ["M  a.ts", " M b c.ts", "A  new.ts", " D gone.ts", "R  to.ts", "from.ts", "UU both.ts", "?? dir/", ""].join("\0");
    expect(parseChanges(output)).toEqual([
      { path: "a.ts", from: null, state: "modified" },
      { path: "b c.ts", from: null, state: "modified" },
      { path: "new.ts", from: null, state: "added" },
      { path: "gone.ts", from: null, state: "deleted" },
      { path: "to.ts", from: "from.ts", state: "renamed" },
      { path: "both.ts", from: null, state: "conflict" },
      { path: "dir/", from: null, state: "untracked" },
    ]);
  });
});

describe("parseStashes", () => {
  it("reads the branch with or without a message", () => {
    const output = ["stash@{0}\x00200\0On main: my message", "stash@{1}\x00100\0WIP on feat/x: abc123 Subject", ""].join("\n");
    expect(parseStashes(output)).toEqual([
      { ref: "stash@{0}", at: 200_000, branch: "main", message: "my message" },
      { ref: "stash@{1}", at: 100_000, branch: "feat/x", message: "abc123 Subject" },
    ]);
  });
});

describe("parseRemoteBranches", () => {
  it("leaves out the default pointer and what exists locally", () => {
    const line = (name: string, symref = "") => [name, symref, "100", "Ann", "s"].join("\0");
    const local = parseBranches(["main", "*", "origin/main", "", "1", "", "s", "abc"].join("\0"), "");
    const tracked = parseBranches(["mine", " ", "origin/other-name", "", "1", "", "s", "abc"].join("\0"), "");
    const output = [line("origin/HEAD", "refs/remotes/origin/main"), line("origin/main"), line("origin/other-name"), line("origin/feat/new")].join("\n");
    expect(parseRemoteBranches(output, [...local, ...tracked])).toEqual([
      { name: "origin/feat/new", at: 100_000, author: "Ann", subject: "s" },
    ]);
  });
});

describe("parseNumstat", () => {
  it("has no line counts for a binary file", () => {
    expect(parseNumstat("3\t1\ta b.ts\n-\t-\tlogo.png\n")).toEqual([
      { path: "a b.ts", insertions: 3, deletions: 1 },
      { path: "logo.png", insertions: null, deletions: null },
    ]);
  });
});

describe("splitPatch", () => {
  it("cuts at file headers only, not at content that looks like one", () => {
    const first = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+diff --git not a header\n";
    const second = "diff --git a/b b/b\nBinary files a/b and b/b differ\n";
    expect(splitPatch(first + second)).toEqual([first, second]);
    expect(splitPatch("")).toEqual([]);
  });
});

describe("attachPatches", () => {
  const stat = (path: string) => ({ path, insertions: 1, deletions: 0 });
  const part = (path: string, size: number) => `diff --git a/${path} b/${path}\n${"x".repeat(size)}\n`;

  it("gives each file its own changes", () => {
    const files = attachPatches([stat("a"), stat("b")], part("a", 5) + part("b", 5));
    expect(files[0].patch).toContain("a/a");
    expect(files[1].patch).toContain("a/b");
    expect(files[1].patch).not.toContain("a/a");
    expect(files[0].truncated).toBe(false);
  });

  it("cuts a huge file without hiding the next ones", () => {
    const files = attachPatches([stat("big"), stat("next")], part("big", 500) + part("next", 5), { perFile: 100 });
    expect(files[0]).toMatchObject({ truncated: true });
    expect(files[0].patch).toHaveLength(100);
    expect(files[1]).toMatchObject({ truncated: false });
    expect(files[1].patch).toContain("a/next");
  });

  it("stops at the limit of the commit", () => {
    const files = attachPatches([stat("a"), stat("b"), stat("c")], part("a", 80) + part("b", 80) + part("c", 80), {
      perCommit: 150,
    });
    expect(files[0].truncated).toBe(false);
    expect(files[1].truncated).toBe(true);
    expect(files[2]).toMatchObject({ patch: null, truncated: false });
  });

  it("shows nothing rather than risk the wrong file", () => {
    const files = attachPatches([stat("a"), stat("b")], part("a", 5));
    expect(files.map(({ patch }) => patch)).toEqual([null, null]);
    expect(attachPatches([stat("a")], undefined)[0].patch).toBeNull();
  });
});

describe("pickCompareBase", () => {
  it("prefers the default branch of the remote, then the usual names", () => {
    expect(pickCompareBase(["main", "prod-line"], "prod-line")).toBe("prod-line");
    expect(pickCompareBase(["x", "master"], null)).toBe("master");
    expect(pickCompareBase(["main"], "absent")).toBe("main");
    expect(pickCompareBase(["x"], null)).toBeNull();
  });
});

describe("readGitDetails working state", () => {
  it("lists changes, stashes, remote branches and the gap with the main branch", async () => {
    const remote = tempRepo();
    commit(remote, "a.txt", "first");
    git(remote, "branch", "from-a-colleague");
    const dir = mkdtempSync(join(tmpdir(), "pm-git-"));
    dirs.push(dir);
    execFileSync("git", ["clone", "-q", remote, dir]);
    git(dir, "switch", "-q", "-c", "feature");
    commit(dir, "b.txt", "on feature");
    git(dir, "switch", "-q", "main");
    writeFileSync(join(dir, "a.txt"), "changed");
    git(dir, "stash", "push", "-q", "-m", "kept for later");
    writeFileSync(join(dir, "a.txt"), "changed again");
    writeFileSync(join(dir, "new.txt"), "new");

    const details = await readGitDetails(dir);
    expect(details.dirtyCount).toBe(2);
    expect(details.trackedChangeCount).toBe(1);
    expect(details.changes).toContainEqual({ path: "a.txt", from: null, state: "modified" });
    expect(details.changes).toContainEqual({ path: "new.txt", from: null, state: "untracked" });
    expect(details.stashes[0]).toMatchObject({ branch: "main", message: "kept for later" });
    expect(details.remoteBranches.map(({ name }) => name)).toEqual(["origin/from-a-colleague"]);
    expect(details.compareBase).toBe("main");
    expect(details.branches.find(({ name }) => name === "feature")).toMatchObject({ baseAhead: 1, baseBehind: 0 });
    expect(details.branches.find(({ name }) => name === "main")?.baseAhead).toBeNull();
  });
});

describe("readCommits", () => {
  it("gives the previous commits page by page, from a fixed commit", async () => {
    const dir = tempRepo();
    git(dir, "commit", "-q", "--allow-empty", "-m", "c0");
    const from = git(dir, "rev-parse", "--short", "HEAD").trim();
    for (let index = 1; index < 35; index += 1) git(dir, "commit", "-q", "--allow-empty", "-m", `c${index}`);

    const first = await readCommits(dir);
    expect(first.commits).toHaveLength(30);
    expect(first.commits[0].subject).toBe("c34");
    expect(first.hasMore).toBe(true);

    const tip = first.commits[0].hash;
    git(dir, "commit", "-q", "--allow-empty", "-m", "made meanwhile");
    const second = await readCommits(dir, { from: tip, skip: 30 });
    expect(second.commits.map(({ subject }) => subject)).toEqual(["c4", "c3", "c2", "c1", "c0"]);
    expect(second.hasMore).toBe(false);
    expect((await readCommits(dir, { from, skip: 0 })).commits).toHaveLength(1);
  });

  it("refuses what is not a hash", async () => {
    const dir = tempRepo();
    commit(dir, "a.txt", "first");
    for (const from of ["--all", "HEAD", "main..main", "-1"]) {
      expect((await readCommits(dir, { from })).commits).toEqual([]);
    }
  });
});

describe("readCommitView", () => {
  it("gives the message, the files and the patch", async () => {
    const dir = tempRepo();
    commit(dir, "a.txt", "first");
    writeFileSync(join(dir, "b.txt"), "line\n");
    git(dir, "add", "b.txt");
    git(dir, "commit", "-q", "-m", "Subject", "-m", "Body text");
    const hash = git(dir, "rev-parse", "--short", "HEAD").trim();

    const view = await readCommitView(dir, hash);
    expect(view).toMatchObject({ hash, author: "t", subject: "Subject", body: "Body text", isMerge: false });
    expect(view?.files).toEqual([
      { path: "b.txt", insertions: 1, deletions: 0, patch: expect.stringContaining("+line"), truncated: false },
    ]);
  });

  it("keeps files and their changes together through renames, binaries and empty files", async () => {
    const dir = tempRepo();
    writeFileSync(join(dir, "old name.txt"), "same content\n".repeat(20));
    writeFileSync(join(dir, "kept.txt"), "before\n");
    commit(dir, "z.txt", "first");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "base");
    git(dir, "mv", "old name.txt", "new name.txt");
    writeFileSync(join(dir, "kept.txt"), "after\n");
    writeFileSync(join(dir, "logo.bin"), Buffer.from([0, 1, 2, 0, 3]));
    writeFileSync(join(dir, "empty.txt"), "");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "mixed");

    const view = await readCommitView(dir, git(dir, "rev-parse", "--short", "HEAD").trim());
    const find = (text: string) => view?.files.find(({ path }) => path.includes(text));
    expect(view?.files).toHaveLength(4);
    expect(find("kept")?.patch).toContain("+after");
    expect(find("kept")?.patch).not.toContain("rename");
    expect(find("new name")?.patch).toContain("rename to new name.txt");
    expect(find("logo")).toMatchObject({ insertions: null, patch: expect.stringContaining("Binary") });
    expect(find("empty")?.patch).toContain("new file");
  });

  it("shows a merge against the branch it went into", async () => {
    const dir = tempRepo();
    commit(dir, "a.txt", "first");
    git(dir, "switch", "-q", "-c", "side");
    commit(dir, "side.txt", "on side");
    git(dir, "switch", "-q", "main");
    commit(dir, "main.txt", "on main");
    git(dir, "merge", "-q", "--no-ff", "-m", "Merge side", "side");
    const view = await readCommitView(dir, git(dir, "rev-parse", "--short", "HEAD").trim());
    expect(view?.isMerge).toBe(true);
    expect(view?.files.map(({ path }) => path)).toEqual(["side.txt"]);
  });

  it("refuses what is not a commit of this repository", async () => {
    const dir = tempRepo();
    commit(dir, "a.txt", "first");
    for (const hash of ["--all", "HEAD", "deadbeef", "main"]) {
      expect(await readCommitView(dir, hash)).toBeNull();
    }
  });
});

describe("readGitDetails line counts", () => {
  it("follows HEAD", async () => {
    const dir = tempRepo();
    commit(dir, "a.txt", "first");
    const added = async () => (await (await readGitDetails(dir)).lines)[0].insertions.at(-1);
    expect(await added()).toBe(1);
    expect(await added()).toBe(1);
    commit(dir, "b.txt", "second");
    expect(await added()).toBe(2);
  });
});

describe("readGitFacts", () => {
  it("handles a repository without any commit", async () => {
    const dir = tempRepo();
    writeFileSync(join(dir, "a.txt"), "a");
    const facts = await readGitFacts(dir);
    expect(facts).toMatchObject({
      branch: "main",
      dirtyCount: 1,
      commitCount: 0,
      lastCommitAt: null,
      lastCommitSubject: null,
      remoteUrl: null,
    });
  });

  it("reads commits, ahead counts and a sanitized remote", async () => {
    const remote = tempRepo();
    commit(remote, "a.txt", "first");
    const dir = mkdtempSync(join(tmpdir(), "pm-git-"));
    dirs.push(dir);
    execFileSync("git", ["clone", "-q", remote, dir]);
    git(dir, "remote", "set-url", "--push", "origin", remote);
    commit(dir, "b.txt", "second subject");
    writeFileSync(join(dir, "c.txt"), "untracked");

    const facts = await readGitFacts(dir);
    expect(facts).toMatchObject({
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      dirtyCount: 1,
      commitCount: 2,
      lastCommitSubject: "second subject",
      lastCommitAuthor: "t",
      branchCount: 1,
      stashCount: 0,
    });
    expect(facts.firstCommitAt).toBeInstanceOf(Date);
    expect(facts.weeklyCommits?.at(-1)).toBe(2);
  });

  it("counts branches and stashes", async () => {
    const dir = tempRepo();
    commit(dir, "a.txt", "first");
    git(dir, "branch", "other");
    writeFileSync(join(dir, "a.txt"), "changed");
    git(dir, "stash", "push", "-q");
    expect(await readGitFacts(dir)).toMatchObject({ branchCount: 2, stashCount: 1 });
  });

  it("has no dates for a repository without commits", async () => {
    expect(await readGitFacts(tempRepo())).toMatchObject({
      firstCommitAt: null,
      lastCommitAuthor: null,
      branchCount: 0,
      stashCount: 0,
    });
  });

  it("does not rewrite the index when reading status", async () => {
    const dir = tempRepo();
    commit(dir, "a.txt", "first");
    // A new mtime makes a plain `git status` want to refresh its stat cache.
    writeFileSync(join(dir, "a.txt"), "first");
    const before = readFileSync(join(dir, ".git", "index"));
    await readGitFacts(dir);
    expect(readFileSync(join(dir, ".git", "index")).equals(before)).toBe(true);
  });

  it("throws outside a repository", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-git-"));
    dirs.push(dir);
    await expect(readGitFacts(dir)).rejects.toThrow();
  });
});
