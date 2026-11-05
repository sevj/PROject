import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkOutAllRemoteBranches,
  checkOutRemoteBranch,
  createBranch,
  deleteMergedBranches,
  fetchRemotes,
  pullFastForward,
  switchBranch,
} from "./git-actions";

const dirs: string[] = [];

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.test", ...args], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
}

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "pm-git-actions-"));
  dirs.push(dir);
  return dir;
}

function tempRepo() {
  const dir = tempDir();
  git(dir, "init", "-q", "-b", "main");
  commit(dir, "a.txt", "first");
  return dir;
}

function commit(dir: string, file: string, message: string) {
  writeFileSync(join(dir, file), message);
  git(dir, "add", file);
  git(dir, "commit", "-q", "-m", message);
}

const currentBranch = (dir: string) => git(dir, "branch", "--show-current");
const branchNames = (dir: string) => git(dir, "for-each-ref", "--format=%(refname:strip=2)", "refs/heads").split("\n");

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("switchBranch", () => {
  it("switches to an existing branch", async () => {
    const dir = tempRepo();
    git(dir, "branch", "other");
    expect(await switchBranch(dir, "other")).toBeNull();
    expect(currentBranch(dir)).toBe("other");
  });

  it("refuses a name that is not a branch of this repository", async () => {
    const dir = tempRepo();
    const tagged = git(dir, "rev-parse", "HEAD");
    for (const name of ["nope", "--detach", tagged, "-"]) {
      expect(await switchBranch(dir, name)).toContain("no longer exists");
    }
    expect(currentBranch(dir)).toBe("main");
  });

  it("refuses with a modified file, even one git could carry along", async () => {
    const dir = tempRepo();
    git(dir, "branch", "other");
    writeFileSync(join(dir, "a.txt"), "changed");
    expect(await switchBranch(dir, "other")).toContain("1 modified file");
    expect(currentBranch(dir)).toBe("main");
  });

  it("does nothing on the current branch", async () => {
    const dir = tempRepo();
    writeFileSync(join(dir, "a.txt"), "changed");
    expect(await switchBranch(dir, "main")).toBeNull();
  });

  it("gives git's refusal for a branch checked out elsewhere", async () => {
    const dir = tempRepo();
    git(dir, "branch", "other");
    const elsewhere = join(tempDir(), "wt");
    git(dir, "worktree", "add", "-q", elsewhere, "other");
    expect(await switchBranch(dir, "other")).toContain("already used by worktree");
    expect(currentBranch(dir)).toBe("main");
  });
});

describe("deleteMergedBranches", () => {
  it("deletes what is merged and keeps the rest", async () => {
    const dir = tempRepo();
    git(dir, "branch", "done");
    git(dir, "switch", "-q", "-c", "wip");
    commit(dir, "b.txt", "unmerged");
    git(dir, "switch", "-q", "main");

    const result = await deleteMergedBranches(dir, ["done", "wip"]);
    expect(result.deleted).toEqual([{ name: "done", hash: git(dir, "rev-parse", "--short", "main") }]);
    expect(result.errors).toEqual([expect.stringContaining("wip")]);
    expect(branchNames(dir).sort()).toEqual(["main", "wip"]);
  });

  it("never deletes a main branch or the current one, even when asked", async () => {
    const dir = tempRepo();
    git(dir, "switch", "-q", "-c", "feature");
    const result = await deleteMergedBranches(dir, ["main", "feature"]);
    expect(result.deleted).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(branchNames(dir).sort()).toEqual(["feature", "main"]);
  });

  it("does not delete a branch with commits its upstream lacks", async () => {
    const remote = tempRepo();
    git(remote, "branch", "shared");
    const dir = join(tempDir(), "clone");
    execFileSync("git", ["clone", "-q", remote, dir]);
    git(dir, "switch", "-q", "shared");
    commit(dir, "local.txt", "only here");
    git(dir, "switch", "-q", "main");
    git(dir, "merge", "-q", "--ff-only", "shared");

    const result = await deleteMergedBranches(dir, ["shared"]);
    expect(result.deleted).toEqual([]);
    expect(result.errors[0]).toContain("not fully merged");
    expect(branchNames(dir)).toContain("shared");
  });
});

function clone(remote: string) {
  const dir = join(tempDir(), "clone");
  execFileSync("git", ["clone", "-q", remote, dir]);
  return dir;
}

describe("createBranch", () => {
  it("creates the branch and moves to it, keeping modified files", async () => {
    const dir = tempRepo();
    writeFileSync(join(dir, "a.txt"), "changed");
    expect(await createBranch(dir, "  feature/new  ")).toBeNull();
    expect(currentBranch(dir)).toBe("feature/new");
    expect(git(dir, "status", "--porcelain")).toContain("a.txt");
  });

  it("refuses an empty or invalid name, and what could read as an option", async () => {
    const dir = tempRepo();
    expect(await createBranch(dir, "   ")).toContain("required");
    for (const name of ["-b", "--detach", "a..b", "a b", "x~1"]) {
      expect(await createBranch(dir, name)).toContain("not a valid");
    }
    expect(currentBranch(dir)).toBe("main");
  });

  it("gives git's refusal for a branch that exists", async () => {
    const dir = tempRepo();
    git(dir, "branch", "taken");
    expect(await createBranch(dir, "taken")).toContain("already exists");
    expect(currentBranch(dir)).toBe("main");
  });
});

describe("checkOutRemoteBranch", () => {
  it("makes the local branch, tracking the remote one", async () => {
    const remote = tempRepo();
    git(remote, "branch", "colleague");
    const dir = clone(remote);
    expect(await checkOutRemoteBranch(dir, "origin/colleague")).toBeNull();
    expect(currentBranch(dir)).toBe("colleague");
    expect(git(dir, "rev-parse", "--abbrev-ref", "@{u}")).toBe("origin/colleague");
  });

  it("refuses an unknown name and a dirty folder", async () => {
    const remote = tempRepo();
    git(remote, "branch", "colleague");
    const dir = clone(remote);
    for (const name of ["origin/nope", "--detach", "origin/main"]) {
      expect(await checkOutRemoteBranch(dir, name)).toContain("no longer exists");
    }
    writeFileSync(join(dir, "a.txt"), "changed");
    expect(await checkOutRemoteBranch(dir, "origin/colleague")).toContain("1 modified file");
    expect(currentBranch(dir)).toBe("main");
  });
});

describe("untracked files", () => {
  const withBranch = () => {
    const dir = tempRepo();
    git(dir, "branch", "other");
    return dir;
  };

  it("do not stop a switch, and stay where they are", async () => {
    const dir = withBranch();
    writeFileSync(join(dir, "notes.txt"), "mine");
    mkdirSync(join(dir, "exports"));
    writeFileSync(join(dir, "exports", "data.csv"), "1,2");

    expect(await switchBranch(dir, "other")).toBeNull();
    expect(currentBranch(dir)).toBe("other");
    expect(readFileSync(join(dir, "notes.txt"), "utf8")).toBe("mine");
    expect(readFileSync(join(dir, "exports", "data.csv"), "utf8")).toBe("1,2");
  });

  it("do not stop checking out a remote branch", async () => {
    const remote = tempRepo();
    git(remote, "branch", "colleague");
    const dir = clone(remote);
    writeFileSync(join(dir, "notes.txt"), "mine");

    expect(await checkOutRemoteBranch(dir, "origin/colleague")).toBeNull();
    expect(currentBranch(dir)).toBe("colleague");
  });

  it("are never overwritten: git refuses, and the reason is passed on", async () => {
    const dir = withBranch();
    git(dir, "switch", "-q", "other");
    commit(dir, "report.txt", "the branch has this file");
    git(dir, "switch", "-q", "main");
    writeFileSync(join(dir, "report.txt"), "mine, not committed");

    expect(await switchBranch(dir, "other")).toEqual(expect.stringContaining("report.txt"));
    expect(currentBranch(dir)).toBe("main");
    expect(readFileSync(join(dir, "report.txt"), "utf8")).toBe("mine, not committed");
  });

  it("do not make up for a tracked file that was changed", async () => {
    const dir = withBranch();
    writeFileSync(join(dir, "notes.txt"), "mine");
    writeFileSync(join(dir, "a.txt"), "changed");

    expect(await switchBranch(dir, "other")).toContain("1 modified file");
    expect(currentBranch(dir)).toBe("main");
  });
});

describe("checkOutAllRemoteBranches", () => {
  it("makes every local branch, tracking the remote one, without moving", async () => {
    const remote = tempRepo();
    git(remote, "branch", "one");
    git(remote, "branch", "feat/two");
    const dir = clone(remote);
    writeFileSync(join(dir, "a.txt"), "changed");

    const result = await checkOutAllRemoteBranches(dir);
    expect(result.errors).toEqual([]);
    expect(result.created.sort()).toEqual(["feat/two", "one"]);
    expect(currentBranch(dir)).toBe("main");
    expect(git(dir, "status", "--porcelain")).toContain("a.txt");
    expect(git(dir, "rev-parse", "--abbrev-ref", "one@{u}")).toBe("origin/one");
    expect((await checkOutAllRemoteBranches(dir)).created).toEqual([]);
  });

  it("takes one branch when two remotes share a name", async () => {
    const remote = tempRepo();
    git(remote, "branch", "shared");
    const dir = clone(remote);
    git(dir, "remote", "add", "fork", remote);
    git(dir, "fetch", "-q", "fork");

    const result = await checkOutAllRemoteBranches(dir);
    expect(result.created).toEqual(["shared"]);
    expect(result.errors).toEqual([]);
  });
});

describe("pullFastForward", () => {
  it("moves the branch forward", async () => {
    const remote = tempRepo();
    const dir = clone(remote);
    commit(remote, "b.txt", "new");
    expect(await pullFastForward(dir)).toBeNull();
    expect(git(dir, "rev-parse", "HEAD")).toBe(git(remote, "rev-parse", "HEAD"));
  });

  it("refuses diverged histories without merging anything", async () => {
    const remote = tempRepo();
    const dir = clone(remote);
    commit(remote, "b.txt", "on the remote");
    commit(dir, "c.txt", "here");
    const before = git(dir, "rev-parse", "HEAD");
    const refusal = await pullFastForward(dir);
    expect(refusal).toContain("fatal");
    expect(refusal).not.toContain("hint:");
    expect(git(dir, "rev-parse", "HEAD")).toBe(before);
    expect(git(dir, "status", "--porcelain")).toBe("");
  });

  it("does not overwrite a local change", async () => {
    const remote = tempRepo();
    const dir = clone(remote);
    commit(remote, "a.txt", "from the remote");
    writeFileSync(join(dir, "a.txt"), "mine");
    expect(await pullFastForward(dir)).toBeTruthy();
    expect(git(dir, "status", "--porcelain")).toContain("a.txt");
  });
});

describe("fetchRemotes", () => {
  describe("with several remotes", () => {
    const withBrokenRemote = () => {
      const remote = tempRepo();
      const dir = clone(remote);
      git(dir, "remote", "add", "broken", join(tempDir(), "nothing-here"));
      git(remote, "branch", "fresh");
      return dir;
    };
    const refs = (dir: string) => git(dir, "for-each-ref", "--format=%(refname:short)");

    it("reads only the chosen one, whatever the state of the others", async () => {
      const dir = withBrokenRemote();
      expect(await fetchRemotes(dir, "origin")).toBeNull();
      expect(refs(dir)).toContain("origin/fresh");
    });

    it("says what went wrong when the chosen one cannot be read", async () => {
      const dir = withBrokenRemote();
      expect(await fetchRemotes(dir, "broken")).toEqual(expect.any(String));
      expect(refs(dir)).not.toContain("origin/fresh");
    });

    it("reads them all when none is chosen", async () => {
      expect(await fetchRemotes(withBrokenRemote())).toEqual(expect.any(String));
    });

    it("runs nothing for a remote that does not exist", async () => {
      const dir = withBrokenRemote();
      for (const name of ["gone", "--all", "--upload-pack=touch /tmp/x", ""]) {
        expect(await fetchRemotes(dir, name)).toContain("no longer exists");
      }
      expect(refs(dir)).not.toContain("origin/fresh");
    });
  });

  it("forgets a remote branch that is gone, and keeps the local one", async () => {
    const remote = tempRepo();
    git(remote, "branch", "old");
    const dir = clone(remote);
    git(dir, "branch", "--track", "old", "origin/old");
    git(remote, "branch", "-D", "old");
    expect(await fetchRemotes(dir)).toBeNull();
    const refs = git(dir, "for-each-ref", "--format=%(refname:short)");
    expect(refs).not.toContain("origin/old");
    expect(refs).toContain("old");
  });

  it("brings new commits without touching the current branch", async () => {
    const remote = tempRepo();
    const dir = join(tempDir(), "clone");
    execFileSync("git", ["clone", "-q", remote, dir]);
    const before = git(dir, "rev-parse", "HEAD");
    commit(remote, "b.txt", "new");

    expect(await fetchRemotes(dir)).toBeNull();
    expect(git(dir, "rev-parse", "HEAD")).toBe(before);
    expect(git(dir, "rev-parse", "origin/main")).toBe(git(remote, "rev-parse", "HEAD"));
  });

  it("reports what git says when the remote is unreachable", async () => {
    const dir = tempRepo();
    git(dir, "remote", "add", "origin", join(tempDir(), "missing"));
    expect(await fetchRemotes(dir)).toBeTruthy();
  });
});
