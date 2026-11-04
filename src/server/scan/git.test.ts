import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ACTIVITY_WEEKS, bucketWeeks, parseStatus, readGitFacts, sanitizeRemoteUrl } from "./git";

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
    });
    expect(facts.weeklyCommits?.at(-1)).toBe(2);
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
