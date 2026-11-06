import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "./db/client";
import {
  type GitlabGet,
  gitlabProjectOf,
  gitlabTokenFor,
  listGitlabAccounts,
  normalizeHost,
  readMergeRequests,
  removeGitlabToken,
  saveGitlabToken,
  type TokenCheck,
} from "./gitlab";
import { getSettings } from "./settings";

let dir: string;
let db: Db;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-gitlab-"));
  process.env.PM_SECRET_KEY_PATH = join(dir, "secret.key");
});
afterAll(() => {
  delete process.env.PM_SECRET_KEY_PATH;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  db = openDb(":memory:");
});

const accepting = vi.fn<TokenCheck>(async () => ({ user: "sevj" }));

describe("normalizeHost", () => {
  it("keeps the host of a URL or of a bare name", () => {
    expect(normalizeHost("https://GitLab.example.com/group/repo")).toBe("gitlab.example.com");
    expect(normalizeHost(" gitlab.com ")).toBe("gitlab.com");
    expect(normalizeHost("git.example.com:8443")).toBe("git.example.com:8443");
  });

  it("refuses what is not a host", () => {
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("localhost")).toBeNull();
    expect(normalizeHost("a b.com")).toBeNull();
  });
});

describe("saveGitlabToken", () => {
  it("keeps the token encrypted, once per host, and never lists it", async () => {
    expect(await saveGitlabToken(db, "gitlab.com", "glpat-one", accepting)).toEqual({ user: "sevj" });
    await saveGitlabToken(db, "https://gitlab.com/x", "glpat-two", accepting);
    expect(accepting).toHaveBeenLastCalledWith("gitlab.com", "glpat-two");
    expect(getSettings(db).gitlabTokens).toHaveLength(1);
    expect(JSON.stringify(getSettings(db))).not.toContain("glpat");
    expect(gitlabTokenFor(db, "gitlab.com")).toBe("glpat-two");
    expect(listGitlabAccounts(db)).toEqual([{ host: "gitlab.com", user: "sevj", savedAt: expect.any(Number) }]);
  });

  it("keeps nothing that the instance refuses or that is malformed", async () => {
    const refusing = vi.fn<TokenCheck>(async () => ({ problem: "refused" }));
    expect(await saveGitlabToken(db, "gitlab.com", "bad", refusing)).toEqual({ problem: "refused" });
    expect(await saveGitlabToken(db, "nope", "glpat", accepting)).toEqual({ problem: "host" });
    expect(await saveGitlabToken(db, "gitlab.com", "  ", accepting)).toEqual({ problem: "token" });
    expect(listGitlabAccounts(db)).toEqual([]);
  });

  it("forgets a host", async () => {
    await saveGitlabToken(db, "gitlab.com", "glpat-one", accepting);
    removeGitlabToken(db, "gitlab.com");
    expect(gitlabTokenFor(db, "gitlab.com")).toBeNull();
  });
});

describe("gitlabProjectOf", () => {
  it("reads host and path from the usual remotes", () => {
    expect(gitlabProjectOf("git@gitlab.com:group/sub/repo.git")).toEqual({ hostname: "gitlab.com", path: "group/sub/repo" });
    expect(gitlabProjectOf("ssh://git@git.example.com:2222/group/repo.git")).toEqual({ hostname: "git.example.com", path: "group/repo" });
    expect(gitlabProjectOf("https://GitLab.com/group/repo")).toEqual({ hostname: "gitlab.com", path: "group/repo" });
    expect(gitlabProjectOf("/srv/repo")).toBeNull();
  });
});

describe("readMergeRequests", () => {
  const mr = (iid: number, username: string, sha: string) => ({
    iid,
    title: `MR ${iid}`,
    author: { name: username.toUpperCase(), username },
    source_branch: `feat/${iid}`,
    target_branch: "main",
    web_url: `https://gitlab.com/group/repo/-/merge_requests/${iid}`,
    draft: iid === 2,
    has_conflicts: false,
    user_notes_count: 3,
    updated_at: "2026-11-05T10:00:00Z",
    merged_at: null,
    sha,
  });
  const api = vi.fn<GitlabGet>(async (_host, _token, path) => {
    if (path.includes("state=opened")) return { status: 200, body: [mr(1, "sevj", "aaa"), mr(2, "ann", "bbb")] };
    if (path.includes("state=merged")) return { status: 200, body: [] };
    return {
      status: 200,
      body: [
        { sha: "aaa", status: "failed", web_url: "p/2" },
        { sha: "aaa", status: "success", web_url: "p/1" },
      ],
    };
  });

  it("asks for a token before calling anything", async () => {
    expect(await readMergeRequests(db, "git@gitlab.com:group/repo.git", api)).toEqual({ forge: "gitlab", problem: "noToken", host: "gitlab.com" });
    expect(await readMergeRequests(db, null, api)).toEqual({ forge: "gitlab", problem: "noRemote", host: null });
    expect(api).not.toHaveBeenCalled();
  });

  it("lists open requests with their latest pipeline and who wrote them", async () => {
    await saveGitlabToken(db, "gitlab.com", "glpat-one", accepting);
    const view = await readMergeRequests(db, "git@gitlab.com:group/repo.git", api);
    expect(api).toHaveBeenCalledWith("gitlab.com", "glpat-one", expect.stringContaining("/projects/group%2Frepo/merge_requests"));
    if ("problem" in view) throw new Error(view.problem);
    expect(view.open.map(({ iid, mine, draft, pipeline }) => ({ iid, mine, draft, pipeline }))).toEqual([
      { iid: 1, mine: true, draft: false, pipeline: { status: "failed", url: "p/2" } },
      { iid: 2, mine: false, draft: true, pipeline: null },
    ]);
  });

  it("tells a refused token from a project it cannot see", async () => {
    await saveGitlabToken(db, "gitlab.com", "glpat-one", accepting);
    const answering = (status: number) => vi.fn<GitlabGet>(async () => ({ status, body: null }));
    expect(await readMergeRequests(db, "git@gitlab.com:g/r.git", answering(401))).toEqual({ forge: "gitlab", problem: "refused", host: "gitlab.com" });
    expect(await readMergeRequests(db, "git@gitlab.com:g/r.git", answering(404))).toEqual({ forge: "gitlab", problem: "notFound", host: "gitlab.com" });
    const failing = vi.fn<GitlabGet>(async () => Promise.reject(new Error("offline")));
    expect(await readMergeRequests(db, "git@gitlab.com:g/r.git", failing)).toEqual({ forge: "gitlab", problem: "unreachable", host: "gitlab.com" });
  });
});
