import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCommitMoments, readCommitMoments } from "./journal";

const dirs: string[] = [];
const FROM = Date.UTC(2026, 0, 5);
const TO = Date.UTC(2026, 0, 12);
const IN_RANGE = Date.UTC(2026, 0, 7, 10);

function git(cwd: string, args: string[], at = IN_RANGE, author = "me@test.dev") {
  const date = new Date(at).toISOString();
  execFileSync("git", ["-c", `user.name=Me`, "-c", `user.email=${author}`, ...args], {
    cwd,
    stdio: "ignore",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

function repo(name = "repo", email = "me@test.dev") {
  const root = mkdtempSync(join(tmpdir(), "pm-journal-"));
  dirs.push(root);
  const dir = join(root, name);
  mkdirSync(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", email]);
  return dir;
}

let count = 0;
function commit(dir: string, at = IN_RANGE, author = "me@test.dev") {
  count += 1;
  writeFileSync(join(dir, `file-${count}.txt`), String(count));
  git(dir, ["add", "."], at, author);
  git(dir, ["commit", "-q", "-m", `commit ${count}`], at, author);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readCommitMoments", () => {
  it("gives each repository its own moments, in the order asked", async () => {
    const a = repo();
    const b = repo();
    const c = repo();
    commit(a, IN_RANGE);
    commit(b, IN_RANGE + 3_600_000);
    expect(await readCommitMoments([a, b, c], FROM, TO)).toEqual([[IN_RANGE], [IN_RANGE + 3_600_000], []]);
  });

  it("keeps to the range", async () => {
    const dir = repo();
    commit(dir, Date.UTC(2025, 11, 1));
    commit(dir, IN_RANGE);
    commit(dir, Date.UTC(2026, 1, 1));
    expect(await readCommitMoments([dir], FROM, TO)).toEqual([[IN_RANGE]]);
  });

  it("reads every branch, and leaves merges out", async () => {
    const dir = repo();
    commit(dir);
    git(dir, ["switch", "-q", "-c", "side"]);
    commit(dir, IN_RANGE + 1000);
    git(dir, ["switch", "-q", "main"]);
    commit(dir, IN_RANGE + 2000);
    git(dir, ["merge", "-q", "--no-edit", "side"], IN_RANGE + 3000);
    const [moments] = await readCommitMoments([dir], FROM, TO);
    expect(moments.sort()).toEqual([IN_RANGE, IN_RANGE + 1000, IN_RANGE + 2000]);
  });

  it("counts only the commits of the address set in that repository", async () => {
    const dir = repo("repo", "me@test.dev");
    commit(dir, IN_RANGE, "me@test.dev");
    commit(dir, IN_RANGE + 1000, "colleague@test.dev");
    expect(await readCommitMoments([dir], FROM, TO)).toEqual([[IN_RANGE]]);
  });

  it("takes an address literally, not as a pattern", async () => {
    const dir = repo("repo", "me+tag@test.dev");
    commit(dir, IN_RANGE, "me+tag@test.dev");
    commit(dir, IN_RANGE + 1000, "meetag@test.dev");
    expect(await readCommitMoments([dir], FROM, TO)).toEqual([[IN_RANGE]]);
  });

  it("gets through odd folders and what is not a repository", async () => {
    const spaced = repo("with a space 'and quote");
    const dashed = repo("-dash");
    const plain = mkdtempSync(join(tmpdir(), "pm-journal-plain-"));
    dirs.push(plain);
    commit(spaced);
    commit(dashed);
    expect(await readCommitMoments([join(plain, "gone"), spaced, plain, dashed], FROM, TO)).toEqual([
      [],
      [IN_RANGE],
      [],
      [IN_RANGE],
    ]);
  });

  it("does not start anything for no repository", async () => {
    expect(await readCommitMoments([], FROM, TO)).toEqual([]);
  });
});

describe("parseCommitMoments", () => {
  it("ignores what is neither a marker nor a date", () => {
    expect(parseCommitMoments(">0\n100\nnoise\n>1\n>9\n200\n0\n", 2)).toEqual([[100_000], []]);
  });
});
