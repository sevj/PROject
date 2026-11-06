import type { Db } from "./db/client";
import { decryptSecret, encryptSecret } from "./secrets";
import { getSettings, saveSettings } from "./settings";

/** What the browser may see of a saved token: never the token itself. */
export type GitlabAccount = { host: string; user: string; savedAt: number };

/** `https://gitlab.example.com/group/repo` or `gitlab.example.com` both give `gitlab.example.com`. */
export function normalizeHost(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  let host: string;
  try {
    host = new URL(/^[a-z]+:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`).host;
  } catch {
    return null;
  }
  return /^[a-z0-9.-]+(:\d{1,5})?$/.test(host) && host.includes(".") ? host : null;
}

/** Answers with the account the token belongs to, or why it is refused. */
export type TokenCheck = (host: string, token: string) => Promise<{ user: string } | { problem: "refused" | "unreachable" }>;

export const checkGitlabToken: TokenCheck = async (host, token) => {
  try {
    const response = await fetch(`https://${host}/api/v4/user`, {
      headers: { "PRIVATE-TOKEN": token, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (response.status === 401 || response.status === 403) return { problem: "refused" };
    if (!response.ok) return { problem: "unreachable" };
    const { username } = (await response.json()) as { username?: unknown };
    return typeof username === "string" ? { user: username } : { problem: "unreachable" };
  } catch {
    return { problem: "unreachable" };
  }
};

export function listGitlabAccounts(db: Db): GitlabAccount[] {
  return getSettings(db).gitlabTokens.map(({ host, user, savedAt }) => ({ host, user, savedAt }));
}

/** Checked against the instance first: a mistyped token is not kept. Replaces the one of that host. */
export async function saveGitlabToken(
  db: Db,
  hostInput: string,
  tokenInput: string,
  check: TokenCheck = checkGitlabToken,
): Promise<{ user: string } | { problem: "host" | "token" | "refused" | "unreachable" }> {
  const host = normalizeHost(hostInput);
  if (!host) return { problem: "host" };
  const token = tokenInput.trim();
  if (!token || /\s/.test(token)) return { problem: "token" };
  const checked = await check(host, token);
  if ("problem" in checked) return checked;
  const others = getSettings(db).gitlabTokens.filter((saved) => saved.host !== host);
  saveSettings(db, {
    gitlabTokens: [...others, { host, user: checked.user, tokenSecret: encryptSecret(token), savedAt: Date.now() }],
  });
  return { user: checked.user };
}

export function removeGitlabToken(db: Db, host: string) {
  saveSettings(db, { gitlabTokens: getSettings(db).gitlabTokens.filter((saved) => saved.host !== host) });
}

/** For the calls made to that instance. Null without a token, or when it can no longer be read. */
export function gitlabTokenFor(db: Db, host: string): string | null {
  const saved = getSettings(db).gitlabTokens.find((entry) => entry.host === host.toLowerCase());
  return saved ? decryptSecret(saved.tokenSecret) : null;
}

/** One GET on the API of an instance. Injected in tests. */
export type GitlabGet = (host: string, token: string, path: string) => Promise<{ status: number; body: unknown }>;

const gitlabGet: GitlabGet = async (host, token, path) => {
  const response = await fetch(`https://${host}/api/v4${path}`, {
    headers: { "PRIVATE-TOKEN": token, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  return { status: response.status, body: response.ok ? await response.json() : null };
};

export type Pipeline = { status: string; url: string };

export type MergeRequest = {
  iid: number;
  title: string;
  author: string;
  /** Whether the token belongs to its author. */
  mine: boolean;
  source: string;
  target: string;
  url: string;
  draft: boolean;
  conflicts: boolean;
  comments: number;
  updatedAt: number;
  mergedAt: number | null;
  pipeline: Pipeline | null;
};

export type Forge = "gitlab" | "github";

export type MergeRequestsProblem = "noRemote" | "noToken" | "unreadableToken" | "refused" | "notFound" | "unreachable";

/** `host` is where the token is looked for: a GitLab instance, or a GitHub owner. */
export type MergeRequestsView =
  | { forge: Forge; host: string; project: string; listUrl: string; user: string; open: MergeRequest[]; merged: MergeRequest[] }
  | { forge: Forge; problem: MergeRequestsProblem; host: string | null };

const OPEN_LIMIT = 50;
const MERGED_LIMIT = 10;

/** `git@host:group/repo.git`, `ssh://git@host:2222/group/repo` and `https://host/group/repo` all give host and path. */
export function gitlabProjectOf(remoteUrl: string): { hostname: string; path: string } | null {
  const scp = /^(?:[\w.-]+@)([\w.-]+):(?!\d+\/)(.+?)(?:\.git)?\/?$/.exec(remoteUrl);
  if (scp) return { hostname: scp[1].toLowerCase(), path: scp[2] };
  try {
    const url = new URL(remoteUrl);
    const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    return path ? { hostname: url.hostname.toLowerCase(), path } : null;
  } catch {
    return null;
  }
}

type RawMergeRequest = {
  iid: number;
  title: string;
  author?: { name?: string; username?: string };
  source_branch: string;
  target_branch: string;
  web_url: string;
  draft?: boolean;
  work_in_progress?: boolean;
  has_conflicts?: boolean;
  user_notes_count?: number;
  updated_at: string;
  merged_at?: string | null;
  sha?: string;
};

const toMergeRequest = (raw: RawMergeRequest, user: string, pipelines: Map<string, Pipeline>): MergeRequest => ({
  iid: raw.iid,
  title: raw.title,
  author: raw.author?.name || raw.author?.username || "",
  mine: raw.author?.username?.toLowerCase() === user.toLowerCase(),
  source: raw.source_branch,
  target: raw.target_branch,
  url: raw.web_url,
  draft: Boolean(raw.draft ?? raw.work_in_progress),
  conflicts: Boolean(raw.has_conflicts),
  comments: raw.user_notes_count ?? 0,
  updatedAt: Date.parse(raw.updated_at),
  mergedAt: raw.merged_at ? Date.parse(raw.merged_at) : null,
  pipeline: (raw.sha && pipelines.get(raw.sha)) || null,
});

/** Read when the PR part of the Git tab opens, never in the background. */
export async function readMergeRequests(db: Db, remoteUrl: string | null, get: GitlabGet = gitlabGet): Promise<MergeRequestsView> {
  const forge = "gitlab";
  const project = remoteUrl ? gitlabProjectOf(remoteUrl) : null;
  if (!project) return { forge, problem: "noRemote", host: null };
  // The token is saved under the web address, which may carry a port the SSH remote does not.
  const saved = getSettings(db).gitlabTokens.find(({ host }) => host.split(":")[0] === project.hostname);
  if (!saved) return { forge, problem: "noToken", host: project.hostname };
  const token = decryptSecret(saved.tokenSecret);
  if (!token) return { forge, problem: "unreadableToken", host: saved.host };

  const base = `/projects/${encodeURIComponent(project.path)}`;
  let responses;
  try {
    responses = await Promise.all([
      get(saved.host, token, `${base}/merge_requests?state=opened&order_by=updated_at&per_page=${OPEN_LIMIT}`),
      get(saved.host, token, `${base}/merge_requests?state=merged&order_by=updated_at&per_page=${MERGED_LIMIT}`),
      get(saved.host, token, `${base}/pipelines?order_by=id&sort=desc&per_page=100`),
    ]);
  } catch {
    return { forge, problem: "unreachable", host: saved.host };
  }
  const [open, merged, pipelines] = responses;
  if (open.status === 401 || open.status === 403) return { forge, problem: "refused", host: saved.host };
  if (open.status === 404) return { forge, problem: "notFound", host: saved.host };
  if (open.status !== 200 || !Array.isArray(open.body)) return { forge, problem: "unreachable", host: saved.host };

  // Newest first: the first pipeline met for a commit is its latest one.
  const bySha = new Map<string, Pipeline>();
  for (const pipeline of Array.isArray(pipelines.body) ? (pipelines.body as { sha: string; status: string; web_url: string }[]) : []) {
    if (!bySha.has(pipeline.sha)) bySha.set(pipeline.sha, { status: pipeline.status, url: pipeline.web_url });
  }
  return {
    forge,
    host: saved.host,
    project: project.path,
    listUrl: `https://${saved.host}/${project.path}/-/merge_requests`,
    user: saved.user,
    open: (open.body as RawMergeRequest[]).map((raw) => toMergeRequest(raw, saved.user, bySha)),
    merged: Array.isArray(merged.body) ? (merged.body as RawMergeRequest[]).map((raw) => toMergeRequest(raw, saved.user, bySha)) : [],
  };
}
