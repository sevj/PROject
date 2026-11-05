import { and, asc, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { type HttpMethod, isHeaderName, isHttpMethod, maskHeader, substitute, VARIABLE_NAME, type Variable, writes } from "@/lib/http-requests";
import type { Db } from "./db/client";
import { type HttpHeader, httpRequests, httpResponses, httpVariables, projectEnvironments } from "./db/schema";
import { decryptSecret, encryptSecret } from "./secrets";

/** What is kept of an answer: enough to read it, not a download. */
const KEPT_BYTES = 512 * 1024;
const READ_BYTES = 4 * 1024 * 1024;
const KEPT_RESPONSES = 10;
const TIMEOUT_MS = 30_000;

/** A secret's value never leaves the server: only whether one is kept. */
export type HeaderView = { name: string; value: string; secret: boolean; hasValue: boolean };
export type RequestView = { id: number; name: string; method: HttpMethod; url: string; headers: HeaderView[]; body: string };
export type VariableView = { name: string; value: string; secret: boolean; hasValue: boolean };
/** `id` null is the machine itself. `baseUrl` is the first address the environment declares. */
export type HttpEnvironment = { id: number | null; name: string; protected: boolean; baseUrl: string | null; variables: VariableView[] };
export type ResponseView = {
  id: number;
  environment: string;
  method: string;
  url: string;
  status: number | null;
  error: string | null;
  durationMs: number;
  size: number;
  headers: [string, string][];
  body: string;
  truncated: boolean;
  sentAt: number;
};
export type HttpView = { requests: RequestView[]; environments: HttpEnvironment[] };

export type HttpProblem = "nameMissing" | "methodInvalid" | "urlMissing" | "headerInvalid" | "variableInvalid" | "requestMissing" | "environmentMissing";

const asView = (header: HttpHeader): HeaderView =>
  header.secret ? { name: header.name, value: "", secret: true, hasValue: header.value !== "" } : { ...header, hasValue: header.value !== "" };

export function listHttp(db: Db, projectId: number): HttpView {
  const requests = db.select().from(httpRequests).where(eq(httpRequests.projectId, projectId)).orderBy(asc(httpRequests.name)).all();
  const environments = db.select().from(projectEnvironments).where(eq(projectEnvironments.projectId, projectId)).orderBy(asc(projectEnvironments.id)).all();
  const variables = db.select().from(httpVariables).where(eq(httpVariables.projectId, projectId)).orderBy(asc(httpVariables.name)).all();
  const variablesOf = (environmentId: number | null) =>
    variables
      .filter((variable) => variable.environmentId === environmentId)
      .map((variable) => ({ name: variable.name, value: variable.secret ? "" : variable.value, secret: variable.secret, hasValue: variable.value !== "" }));
  return {
    requests: requests.map((request) => ({
      id: request.id,
      name: request.name,
      method: isHttpMethod(request.method) ? request.method : "GET",
      url: request.url,
      headers: request.headers.map(asView),
      body: request.body ?? "",
    })),
    environments: [
      { id: null, name: "Local", protected: false, baseUrl: null, variables: variablesOf(null) },
      ...environments.map((environment) => ({
        id: environment.id,
        name: environment.name,
        protected: environment.protected,
        baseUrl: environment.urls[0]?.url ?? null,
        variables: variablesOf(environment.id),
      })),
    ],
  };
}

export type RequestInput = { name: string; method: string; url: string; headers: HeaderView[]; body: string };

/** A secret left empty keeps the value it had under the same name. */
function sealHeaders(rows: HeaderView[], before: HttpHeader[]): HttpHeader[] | null {
  const headers: HttpHeader[] = [];
  for (const row of rows) {
    const name = String(row?.name ?? "").trim();
    const value = String(row?.value ?? "");
    if (!name && !value) continue;
    if (!isHeaderName(name) || /[\r\n]/.test(value)) return null;
    const secret = row.secret === true;
    if (!secret) headers.push({ name, value, secret });
    else if (value) headers.push({ name, value: encryptSecret(value), secret });
    else headers.push({ name, value: before.find((old) => old.secret && old.name === name)?.value ?? "", secret });
  }
  return headers;
}

export function saveRequest(db: Db, projectId: number, id: number | null, input: RequestInput): { id: number } | { problem: HttpProblem } {
  const name = String(input?.name ?? "").trim().slice(0, 120);
  if (!name) return { problem: "nameMissing" };
  if (!isHttpMethod(input.method)) return { problem: "methodInvalid" };
  const url = String(input.url ?? "").trim();
  if (!url || url.length > 8000) return { problem: "urlMissing" };
  const current = id === null ? null : db.select().from(httpRequests).where(and(eq(httpRequests.id, id), eq(httpRequests.projectId, projectId))).get();
  if (id !== null && !current) return { problem: "requestMissing" };
  const headers = sealHeaders(Array.isArray(input.headers) ? input.headers : [], current?.headers ?? []);
  if (!headers) return { problem: "headerInvalid" };
  const values = { projectId, name, method: input.method, url, headers, body: String(input.body ?? "") || null, updatedAt: new Date() };
  if (current) {
    db.update(httpRequests).set(values).where(eq(httpRequests.id, current.id)).run();
    return { id: current.id };
  }
  return { id: db.insert(httpRequests).values(values).returning({ id: httpRequests.id }).get().id };
}

export function deleteRequest(db: Db, projectId: number, id: number): void {
  db.delete(httpRequests).where(and(eq(httpRequests.id, id), eq(httpRequests.projectId, projectId))).run();
}

const environmentOf = (db: Db, projectId: number, environmentId: number | null) =>
  environmentId === null ? { id: null, name: "Local", protected: false, urls: [] as { url: string }[] } : (db.select().from(projectEnvironments).where(and(eq(projectEnvironments.id, environmentId), eq(projectEnvironments.projectId, projectId))).get() ?? null);

const scope = (projectId: number, environmentId: number | null) =>
  and(eq(httpVariables.projectId, projectId), environmentId === null ? isNull(httpVariables.environmentId) : eq(httpVariables.environmentId, environmentId));

/** The whole list of an environment, replaced: a secret left empty keeps its value. */
export function saveVariables(db: Db, projectId: number, environmentId: number | null, rows: VariableView[]): HttpProblem | null {
  if (!environmentOf(db, projectId, environmentId)) return "environmentMissing";
  const before = db.select().from(httpVariables).where(scope(projectId, environmentId)).all();
  const kept: { name: string; value: string; secret: boolean }[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = String(row?.name ?? "").trim();
    const value = String(row?.value ?? "");
    if (!name && !value) continue;
    if (!VARIABLE_NAME.test(name) || kept.some((item) => item.name === name) || value.length > 8000) return "variableInvalid";
    const secret = row.secret === true;
    const old = before.find((item) => item.name === name);
    kept.push({ name, secret, value: !secret ? value : value ? encryptSecret(value) : old?.secret ? old.value : "" });
  }
  db.transaction((tx) => {
    tx.delete(httpVariables).where(scope(projectId, environmentId)).run();
    for (const item of kept) tx.insert(httpVariables).values({ projectId, environmentId, ...item }).run();
  });
  return null;
}

/** The values, secrets opened, for sending: `baseUrl` from the environment unless one is set. */
function variablesFor(db: Db, projectId: number, environment: { id: number | null; urls: { url: string }[] }): Variable[] {
  const rows = db.select().from(httpVariables).where(scope(projectId, environment.id)).all();
  const own: Variable[] = rows.map((row) => ({ name: row.name, value: row.secret ? (decryptSecret(row.value) ?? "") : row.value, secret: row.secret }));
  const baseUrl = environment.urls[0]?.url;
  return baseUrl && !own.some(({ name }) => name === "baseUrl") ? [...own, { name: "baseUrl", value: baseUrl.replace(/\/+$/, ""), secret: false }] : own;
}

export type Sender = (url: string, init: RequestInit) => Promise<Response>;

export type SendResult = { response: ResponseView } | { problem: "needsConfirm" | "missing" | "urlInvalid" | "requestMissing" | "environmentMissing"; detail?: string };

/**
 * Sent from the server, so that the browser's rules on other sites do not stand in the way. A
 * request that writes, to a protected environment, goes only once confirmed.
 */
export async function sendRequest(db: Db, projectId: number, requestId: number, environmentId: number | null, confirmed: boolean, sender: Sender = fetch): Promise<SendResult> {
  const request = db.select().from(httpRequests).where(and(eq(httpRequests.id, requestId), eq(httpRequests.projectId, projectId))).get();
  if (!request || !isHttpMethod(request.method)) return { problem: "requestMissing" };
  const environment = environmentOf(db, projectId, environmentId);
  if (!environment) return { problem: "environmentMissing" };
  if (environment.protected && writes(request.method) && !confirmed) return { problem: "needsConfirm", detail: environment.name };

  const variables = variablesFor(db, projectId, environment);
  const url = substitute(request.url, variables);
  const headers = request.headers.map((header) => ({ name: header.name, value: substitute(header.secret ? (decryptSecret(header.value) ?? "") : header.value, variables) }));
  const body = request.body && writes(request.method) ? substitute(request.body, variables) : null;
  const missing = [...new Set([...url.missing, ...headers.flatMap(({ value }) => value.missing), ...(body?.missing ?? [])])];
  if (missing.length > 0) return { problem: "missing", detail: missing.join(", ") };
  let target: URL;
  try {
    target = new URL(url.text);
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("scheme");
  } catch {
    return { problem: "urlInvalid", detail: url.shown };
  }

  const started = Date.now();
  let kept: Omit<typeof httpResponses.$inferInsert, "requestId" | "environment" | "method" | "url" | "durationMs">;
  try {
    const answer = await sender(target.toString(), {
      method: request.method,
      headers: headers.map(({ name, value }) => [name, value.text] as [string, string]),
      body: body?.text,
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const { text, size } = await readBody(answer);
    kept = {
      status: answer.status,
      error: null,
      size,
      headers: [...answer.headers.entries()].map(maskHeader),
      body: text.slice(0, KEPT_BYTES),
      truncated: size > KEPT_BYTES || text.length > KEPT_BYTES,
    };
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message;
    kept = { status: null, error: [error instanceof Error ? error.message : String(error), cause].filter(Boolean).join(": "), size: 0, headers: [], body: "", truncated: false };
  }
  const row = db
    .insert(httpResponses)
    .values({ requestId, environment: environment.name, method: request.method, url: url.shown, durationMs: Date.now() - started, ...kept, sentAt: new Date() })
    .returning()
    .get();
  const old = db.select({ id: httpResponses.id }).from(httpResponses).where(eq(httpResponses.requestId, requestId)).orderBy(desc(httpResponses.id)).limit(KEPT_RESPONSES).all();
  db.delete(httpResponses).where(and(eq(httpResponses.requestId, requestId), notInArray(httpResponses.id, old.map(({ id }) => id)))).run();
  return { response: toResponseView(row) };
}

/** Read up to a few MB: a bigger answer is counted, not kept. */
async function readBody(answer: Response): Promise<{ text: string; size: number }> {
  if (!answer.body) return { text: "", size: 0 };
  const reader = answer.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size <= READ_BYTES) chunks.push(value);
    else {
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), size };
}

const toResponseView = (row: typeof httpResponses.$inferSelect): ResponseView => ({
  id: row.id,
  environment: row.environment,
  method: row.method,
  url: row.url,
  status: row.status,
  error: row.error,
  durationMs: row.durationMs,
  size: row.size,
  headers: row.headers,
  body: row.body,
  truncated: row.truncated,
  sentAt: row.sentAt.getTime(),
});

/** Newest first. */
export function listResponses(db: Db, projectId: number, requestId: number): ResponseView[] {
  const owned = db.select({ id: httpRequests.id }).from(httpRequests).where(and(eq(httpRequests.id, requestId), eq(httpRequests.projectId, projectId))).get();
  if (!owned) return [];
  return db.select().from(httpResponses).where(eq(httpResponses.requestId, requestId)).orderBy(desc(httpResponses.id)).all().map(toResponseView);
}

export function clearResponses(db: Db, projectId: number, requestIds: number[]): void {
  const owned = db.select({ id: httpRequests.id }).from(httpRequests).where(and(eq(httpRequests.projectId, projectId), inArray(httpRequests.id, requestIds))).all();
  if (owned.length > 0) db.delete(httpResponses).where(inArray(httpResponses.requestId, owned.map(({ id }) => id))).run();
}
