import type { Db } from "./db/client";
import { decryptSecret, encryptSecret } from "./secrets";
import { getSettings, saveSettings } from "./settings";

export const DEFAULT_APM_URL = "https://apm.adimeo.com";

/** What the browser may see of the connection: never the token itself. */
export type ApmAccount = { url: string; user: string; savedAt: number };

export type ApmProject = { id: number; name: string; active: boolean; client: string | null };

export type ApmTicket = {
  id: number;
  type: "ticket" | "task";
  title: string;
  status: string | null;
  /** Higher is further along in the workflow. */
  statusWeight: number | null;
  /** Done or abandoned, as APM tells it. */
  closed: boolean;
  /** 1 low to 4 urgent, as in APM. */
  priority: number | null;
  priorityLabel: string | null;
  assignee: { id: number; name: string } | null;
  createdAt: number;
  updatedAt: number;
  url: string;
};

export const APM_STATES = ["open", "closed", "all"] as const;
export type ApmState = (typeof APM_STATES)[number];
export const APM_ASSIGNEES = ["all", "me", "none"] as const;
export type ApmAssignee = (typeof APM_ASSIGNEES)[number];
export type ApmTicketsQuery = { state: ApmState; assignee: ApmAssignee; search: string; page: number };

export type ApmProblem = "noToken" | "unreadableToken" | "refused" | "notFound" | "unreachable";

export type ApmTicketsView =
  | {
      url: string;
      project: ApmProject;
      tickets: ApmTicket[];
      /** The token owner's id in APM: their tickets stand out. */
      meId: number | null;
      total: number;
      page: number;
      pages: number;
      query: ApmTicketsQuery;
    }
  | { problem: ApmProblem; url: string | null };

export const APM_PAGE_SIZE = 50;

/**
 * `apm.adimeo.com` or `https://apm.adimeo.com/my-account` both give `https://apm.adimeo.com`.
 * HTTPS only: the token goes in every request.
 */
export function normalizeApmUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === "https:" && url.hostname.includes(".") && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

/** One GET on the API of APM. Injected in tests. */
export type ApmGet = (url: string, token: string, path: string) => Promise<{ status: number; body: unknown }>;

const apmGet: ApmGet = async (url, token, path) => {
  const response = await fetch(`${url}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    // A redirect could carry the token elsewhere.
    redirect: "error",
  });
  return { status: response.status, body: response.ok ? await response.json() : null };
};

const problemOf = (status: number): ApmProblem => (status === 401 || status === 403 ? "refused" : status === 404 ? "notFound" : "unreachable");

const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const int = (value: unknown): number | null => (Number.isInteger(value) ? (value as number) : null);

function toProject(raw: unknown): ApmProject | null {
  const project = record(raw);
  const id = int(project.id);
  const name = str(project.name);
  return id !== null && name !== null ? { id, name, active: project.active === true, client: str(project.client) } : null;
}

function toTicket(raw: unknown): ApmTicket | null {
  const task = record(raw);
  const id = int(task.id);
  const title = str(task.title);
  const url = str(task.url);
  // Only links to APM itself are shown.
  if (id === null || title === null || url === null || !/^https:\/\//.test(url)) return null;
  const status = record(task.status);
  const assignee = record(task.assigned_to);
  const assigneeId = int(assignee.id);
  const date = (value: unknown) => {
    const parsed = Date.parse(str(value) ?? "");
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  return {
    id,
    type: task.type === "task" ? "task" : "ticket",
    title,
    status: str(status.label),
    statusWeight: int(status.weight),
    closed: status.closed === true,
    priority: int(task.priority),
    priorityLabel: str(task.priority_label),
    assignee: assigneeId !== null ? { id: assigneeId, name: str(assignee.name) || `#${assigneeId}` } : null,
    createdAt: date(task.created),
    updatedAt: date(task.updated) || date(task.created),
    url,
  };
}

/** Answers with who the token belongs to, or why it is refused. */
export type ApmTokenCheck = (url: string, token: string) => Promise<{ user: string; userId: number | null } | { problem: "refused" | "unreachable" }>;

export const checkApmToken: ApmTokenCheck = async (url, token) => {
  try {
    const { status, body } = await apmGet(url, token, "/me");
    if (status !== 200) return { problem: status === 401 || status === 403 ? "refused" : "unreachable" };
    const me = record(body);
    const name = [str(me.first_name), str(me.last_name)].filter(Boolean).join(" ").trim();
    const user = name || str(me.email);
    return user ? { user, userId: int(me.id) } : { problem: "unreachable" };
  } catch {
    return { problem: "unreachable" };
  }
};

export function getApmAccount(db: Db): ApmAccount | null {
  const apm = getSettings(db).apm;
  return apm ? { url: apm.url, user: apm.user, savedAt: apm.savedAt } : null;
}

/** Checked against APM first: a mistyped token or address is not kept. Replaces the previous one. */
export async function saveApmConnection(
  db: Db,
  urlInput: string,
  tokenInput: string,
  check: ApmTokenCheck = checkApmToken,
): Promise<{ url: string; user: string } | { problem: "url" | "token" | "refused" | "unreachable" }> {
  const url = normalizeApmUrl(urlInput);
  if (!url) return { problem: "url" };
  const token = tokenInput.trim();
  if (!token || /\s/.test(token)) return { problem: "token" };
  const checked = await check(url, token);
  if ("problem" in checked) return checked;
  saveSettings(db, {
    apm: { url, user: checked.user, ...(checked.userId !== null ? { userId: checked.userId } : {}), tokenSecret: encryptSecret(token), savedAt: Date.now() },
  });
  return { url, user: checked.user };
}

export function removeApmConnection(db: Db) {
  saveSettings(db, { apm: null });
}

function connection(db: Db): { url: string; token: string; userId: number | null } | { problem: ApmProblem; url: string | null } {
  const apm = getSettings(db).apm;
  if (!apm) return { problem: "noToken", url: null };
  const token = decryptSecret(apm.tokenSecret);
  return token ? { url: apm.url, token, userId: Number.isInteger(apm.userId) ? (apm.userId as number) : null } : { problem: "unreadableToken", url: apm.url };
}

/** For a connection saved before the owner's id was kept: asked once, then kept. */
async function ownerId(db: Db, apm: { url: string; token: string; userId: number | null }, get: ApmGet): Promise<number | null> {
  if (apm.userId !== null) return apm.userId;
  const { status, body } = await get(apm.url, apm.token, "/me");
  const id = status === 200 ? int(record(body).id) : null;
  const saved = getSettings(db).apm;
  if (id !== null && saved) saveSettings(db, { apm: { ...saved, userId: id } });
  return id;
}

/** The projects the token's owner can see in APM, active ones first. */
export async function listApmProjects(db: Db, get: ApmGet = apmGet): Promise<{ projects: ApmProject[] } | { problem: ApmProblem; url: string | null }> {
  const apm = connection(db);
  if ("problem" in apm) return apm;
  try {
    const { status, body } = await get(apm.url, apm.token, "/projects");
    if (status !== 200) return { problem: problemOf(status), url: apm.url };
    const projects = (Array.isArray(record(body).items) ? (record(body).items as unknown[]) : []).flatMap((raw) => toProject(raw) ?? []);
    return { projects: projects.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "fr")) };
  } catch {
    return { problem: "unreachable", url: apm.url };
  }
}

/** Read when the Tickets tab opens, never in the background. */
export async function readApmTickets(db: Db, apmProjectId: number, query: ApmTicketsQuery, get: ApmGet = apmGet): Promise<ApmTicketsView> {
  const apm = connection(db);
  if ("problem" in apm) return apm;
  const params = new URLSearchParams({ state: query.state, page: String(query.page), limit: String(APM_PAGE_SIZE) });
  if (query.assignee !== "all") params.set("assignee", query.assignee);
  if (query.search) params.set("search", query.search);
  try {
    const [project, tasks, meId] = await Promise.all([
      get(apm.url, apm.token, `/projects/${apmProjectId}`),
      get(apm.url, apm.token, `/projects/${apmProjectId}/tasks?${params}`),
      ownerId(db, apm, get),
    ]);
    const failed = [project, tasks].find(({ status }) => status !== 200);
    if (failed) return { problem: problemOf(failed.status), url: apm.url };
    const read = toProject(project.body);
    if (!read) return { problem: "unreachable", url: apm.url };
    const list = record(tasks.body);
    const total = int(list.total) ?? 0;
    return {
      url: apm.url,
      project: read,
      tickets: (Array.isArray(list.items) ? list.items : []).flatMap((raw) => toTicket(raw) ?? []),
      meId,
      total,
      page: query.page,
      pages: Math.max(1, Math.ceil(total / APM_PAGE_SIZE)),
      query,
    };
  } catch {
    return { problem: "unreachable", url: apm.url };
  }
}

/** The query of the Tickets tab, from the address: anything unexpected falls back to the open tickets. */
export function readTicketsQuery(params: { state?: unknown; assignee?: unknown; q?: unknown; page?: unknown }): ApmTicketsQuery {
  const state = APM_STATES.find((value) => value === params.state) ?? "open";
  const assignee = APM_ASSIGNEES.find((value) => value === params.assignee) ?? "all";
  const search = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  const page = typeof params.page === "string" && /^\d{1,5}$/.test(params.page) ? Math.max(1, Number(params.page)) : 1;
  return { state, assignee, search, page };
}
