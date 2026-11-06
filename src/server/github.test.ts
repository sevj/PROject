import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "./db/client";
import {
  type GithubGet,
  type GithubTokenCheck,
  listGithubAccounts,
  normalizeOwner,
  readPullRequests,
  removeGithubToken,
  saveGithubToken,
  summarizeRuns,
} from "./github";
import { getSettings } from "./settings";

let dir: string;
let db: Db;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-github-"));
  process.env.PM_SECRET_KEY_PATH = join(dir, "secret.key");
});
afterAll(() => {
  delete process.env.PM_SECRET_KEY_PATH;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  db = openDb(":memory:");
});

const accepting = vi.fn<GithubTokenCheck>(async () => ({ user: "sevj" }));

describe("normalizeOwner", () => {
  it("keeps the owner of a name or a URL", () => {
    expect(normalizeOwner("sevj")).toBe("sevj");
    expect(normalizeOwner("@adimeo-fr")).toBe("adimeo-fr");
    expect(normalizeOwner("https://github.com/adimeo-fr/connector")).toBe("adimeo-fr");
    expect(normalizeOwner("not a name")).toBeNull();
  });
});

describe("saveGithubToken", () => {
  it("keeps one encrypted token per owner, whatever its case", async () => {
    expect(await saveGithubToken(db, "sevj", "github_pat_one", accepting)).toEqual({ owner: "sevj", user: "sevj" });
    await saveGithubToken(db, "Sevj", "github_pat_two", accepting);
    expect(getSettings(db).githubTokens).toHaveLength(1);
    expect(JSON.stringify(getSettings(db))).not.toContain("github_pat");
    removeGithubToken(db, "SEVJ");
    expect(listGithubAccounts(db)).toEqual([]);
  });

  it("keeps nothing GitHub refuses", async () => {
    const refusing = vi.fn<GithubTokenCheck>(async () => ({ problem: "refused" }));
    expect(await saveGithubToken(db, "sevj", "bad", refusing)).toEqual({ problem: "refused" });
    expect(listGithubAccounts(db)).toEqual([]);
  });
});

describe("summarizeRuns", () => {
  it("keeps the worst run of each commit", () => {
    const run = (sha: string, status: string, conclusion: string | null, url = sha + status) => ({ head_sha: sha, status, conclusion, html_url: url });
    const runs = summarizeRuns([
      run("a", "completed", "success"),
      run("a", "completed", "failure", "fail"),
      run("b", "in_progress", null),
      run("c", "completed", "cancelled"),
    ]);
    expect(runs.get("a")).toEqual({ status: "failed", url: "fail" });
    expect(runs.get("b")?.status).toBe("running");
    expect(runs.get("c")?.status).toBe("canceled");
  });
});

describe("readPullRequests", () => {
  const pull = (number: number, login: string, merged: string | null = null) => ({
    number,
    title: `PR ${number}`,
    user: { login },
    head: { ref: `feat/${number}`, sha: `sha${number}` },
    base: { ref: "main" },
    html_url: `https://github.com/sevj/repo/pull/${number}`,
    draft: false,
    updated_at: "2026-11-05T10:00:00Z",
    merged_at: merged,
  });
  const api = vi.fn<GithubGet>(async (_token, path) => {
    if (path.includes("state=open")) return { status: 200, body: [pull(1, "sevj"), pull(2, "ann")] };
    if (path.includes("state=closed")) return { status: 200, body: [pull(3, "ann", "2026-11-04T10:00:00Z"), pull(4, "ann")] };
    return { status: 200, body: { workflow_runs: [{ head_sha: "sha1", status: "completed", conclusion: "success", html_url: "run" }] } };
  });

  it("asks for a token of that owner", async () => {
    expect(await readPullRequests(db, "sevj", "repo", api)).toEqual({ forge: "github", problem: "noToken", host: "sevj" });
  });

  it("lists open requests with their CI, and only the closed ones that were merged", async () => {
    await saveGithubToken(db, "sevj", "github_pat_one", accepting);
    const view = await readPullRequests(db, "sevj", "repo", api);
    expect(api).toHaveBeenCalledWith("github_pat_one", expect.stringContaining("/repos/sevj/repo/pulls?state=open"));
    if ("problem" in view) throw new Error(view.problem);
    expect(view.open.map(({ iid, mine, pipeline }) => ({ iid, mine, pipeline }))).toEqual([
      { iid: 1, mine: true, pipeline: { status: "success", url: "run" } },
      { iid: 2, mine: false, pipeline: null },
    ]);
    expect(view.merged.map(({ iid }) => iid)).toEqual([3]);
  });

  it("reads a repository the token cannot reach as not found", async () => {
    await saveGithubToken(db, "sevj", "github_pat_one", accepting);
    const missing = vi.fn<GithubGet>(async () => ({ status: 404, body: null }));
    expect(await readPullRequests(db, "sevj", "repo", missing)).toEqual({ forge: "github", problem: "notFound", host: "sevj" });
  });
});
