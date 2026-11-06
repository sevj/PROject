import type { Db } from "./db/client";
import { gitlabProjectOf, type MergeRequest, type MergeRequestsView, type Pipeline, readMergeRequests } from "./gitlab";
import { decryptSecret, encryptSecret } from "./secrets";
import { getSettings, saveSettings } from "./settings";

const API = "https://api.github.com";

/** GitHub refuses a request without a User-Agent: a generic one, nothing about who uses the app. */
const headersFor = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "project-manager",
});

/** What the browser may see of a saved token: never the token itself. */
export type GithubAccount = { owner: string; user: string; savedAt: number };

/** `sevj`, `@sevj` or `https://github.com/sevj/repo` all give `sevj`. */
export function normalizeOwner(input: string): string | null {
  const owner = input
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/^@/, "")
    .split("/")[0];
  return /^[a-z\d](?:[a-z\d-]{0,38})$/i.test(owner) ? owner : null;
}

export type GithubTokenCheck = (token: string) => Promise<{ user: string } | { problem: "refused" | "unreachable" }>;

export const checkGithubToken: GithubTokenCheck = async (token) => {
  try {
    const response = await fetch(`${API}/user`, { headers: headersFor(token), signal: AbortSignal.timeout(15_000) });
    if (response.status === 401 || response.status === 403) return { problem: "refused" };
    if (!response.ok) return { problem: "unreachable" };
    const { login } = (await response.json()) as { login?: unknown };
    return typeof login === "string" ? { user: login } : { problem: "unreachable" };
  } catch {
    return { problem: "unreachable" };
  }
};

export function listGithubAccounts(db: Db): GithubAccount[] {
  return getSettings(db).githubTokens.map(({ owner, user, savedAt }) => ({ owner, user, savedAt }));
}

/** Checked against GitHub first: a mistyped token is not kept. Replaces the one of that owner. */
export async function saveGithubToken(
  db: Db,
  ownerInput: string,
  tokenInput: string,
  check: GithubTokenCheck = checkGithubToken,
): Promise<{ owner: string; user: string } | { problem: "host" | "token" | "refused" | "unreachable" }> {
  const owner = normalizeOwner(ownerInput);
  if (!owner) return { problem: "host" };
  const token = tokenInput.trim();
  if (!token || /\s/.test(token)) return { problem: "token" };
  const checked = await check(token);
  if ("problem" in checked) return checked;
  const others = getSettings(db).githubTokens.filter((saved) => saved.owner.toLowerCase() !== owner.toLowerCase());
  saveSettings(db, {
    githubTokens: [...others, { owner, user: checked.user, tokenSecret: encryptSecret(token), savedAt: Date.now() }],
  });
  return { owner, user: checked.user };
}

export function removeGithubToken(db: Db, owner: string) {
  saveSettings(db, { githubTokens: getSettings(db).githubTokens.filter((saved) => saved.owner.toLowerCase() !== owner.toLowerCase()) });
}

/** One GET on the API. Injected in tests. */
export type GithubGet = (token: string, path: string) => Promise<{ status: number; body: unknown }>;

const githubGet: GithubGet = async (token, path) => {
  const response = await fetch(`${API}${path}`, { headers: headersFor(token), signal: AbortSignal.timeout(15_000) });
  return { status: response.status, body: response.ok ? await response.json() : null };
};

type RawPull = {
  number: number;
  title: string;
  user?: { login?: string };
  head: { ref: string; sha: string };
  base: { ref: string };
  html_url: string;
  draft?: boolean;
  updated_at: string;
  merged_at?: string | null;
};

type RawRun = { head_sha: string; status: string; conclusion: string | null; html_url: string };

/**
 * Several workflows can run on one commit: the worst of their latest runs is what counts.
 * Named like GitLab's statuses, so that both read the same.
 */
export function summarizeRuns(runs: RawRun[]): Map<string, Pipeline> {
  const rank = { failed: 5, running: 4, pending: 3, canceled: 2, success: 1, skipped: 0 } as const;
  const statusOf = ({ status, conclusion }: RawRun): keyof typeof rank => {
    if (status === "in_progress") return "running";
    if (status !== "completed") return "pending";
    if (conclusion === "success" || conclusion === "neutral") return "success";
    if (conclusion === "cancelled") return "canceled";
    if (conclusion === "skipped") return "skipped";
    return "failed";
  };
  const bySha = new Map<string, Pipeline>();
  for (const run of runs) {
    const status = statusOf(run);
    const known = bySha.get(run.head_sha);
    if (!known || rank[status] > rank[known.status as keyof typeof rank]) bySha.set(run.head_sha, { status, url: run.html_url });
  }
  return bySha;
}

const toMergeRequest = (raw: RawPull, user: string, runs: Map<string, Pipeline>): MergeRequest => ({
  iid: raw.number,
  title: raw.title,
  author: raw.user?.login ?? "",
  mine: raw.user?.login?.toLowerCase() === user.toLowerCase(),
  source: raw.head.ref,
  target: raw.base.ref,
  url: raw.html_url,
  draft: Boolean(raw.draft),
  // Neither is in GitHub's list: each would cost a call per request.
  conflicts: false,
  comments: 0,
  updatedAt: Date.parse(raw.updated_at),
  mergedAt: raw.merged_at ? Date.parse(raw.merged_at) : null,
  pipeline: runs.get(raw.head.sha) ?? null,
});

/** Read when the PR part of the Git tab opens, never in the background. */
export async function readPullRequests(db: Db, owner: string, repo: string, get: GithubGet = githubGet): Promise<MergeRequestsView> {
  const forge = "github";
  const saved = getSettings(db).githubTokens.find((entry) => entry.owner.toLowerCase() === owner.toLowerCase());
  if (!saved) return { forge, problem: "noToken", host: owner };
  const token = decryptSecret(saved.tokenSecret);
  if (!token) return { forge, problem: "unreadableToken", host: owner };

  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let responses;
  try {
    responses = await Promise.all([
      get(token, `${base}/pulls?state=open&sort=updated&direction=desc&per_page=50`),
      get(token, `${base}/pulls?state=closed&sort=updated&direction=desc&per_page=30`),
      get(token, `${base}/actions/runs?per_page=100`),
    ]);
  } catch {
    return { forge, problem: "unreachable", host: owner };
  }
  const [open, closed, runs] = responses;
  if (open.status === 401 || open.status === 403) return { forge, problem: "refused", host: owner };
  // What a fine-grained token cannot reach reads as missing.
  if (open.status === 404) return { forge, problem: "notFound", host: owner };
  if (open.status !== 200 || !Array.isArray(open.body)) return { forge, problem: "unreachable", host: owner };

  const byRun = summarizeRuns(((runs.body as { workflow_runs?: RawRun[] } | null)?.workflow_runs) ?? []);
  return {
    forge,
    host: owner,
    project: `${owner}/${repo}`,
    listUrl: `https://github.com/${owner}/${repo}/pulls`,
    user: saved.user,
    open: (open.body as RawPull[]).map((raw) => toMergeRequest(raw, saved.user, byRun)),
    merged: (Array.isArray(closed.body) ? (closed.body as RawPull[]) : [])
      .filter(({ merged_at }) => merged_at)
      .slice(0, 10)
      .map((raw) => toMergeRequest(raw, saved.user, byRun)),
  };
}

/** GitHub or GitLab, after the remote of the project. */
export async function readProjectRequests(db: Db, remoteUrl: string | null): Promise<MergeRequestsView> {
  const project = remoteUrl ? gitlabProjectOf(remoteUrl) : null;
  if (project?.hostname === "github.com") {
    const [owner, repo] = project.path.split("/");
    if (owner && repo) return readPullRequests(db, owner, repo);
  }
  return readMergeRequests(db, remoteUrl);
}
