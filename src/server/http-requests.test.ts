import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "./db/client";
import { httpRequests, httpVariables, projectEnvironments, projects } from "./db/schema";
import { listHttp, listResponses, type RequestInput, saveRequest, saveVariables, type Sender, sendRequest } from "./http-requests";

let dir: string;
let db: Db;
let projectId: number;
let recette: number;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-http-"));
  process.env.PM_SECRET_KEY_PATH = join(dir, "secret.key");
});
afterAll(() => {
  delete process.env.PM_SECRET_KEY_PATH;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  db = openDb(":memory:");
  projectId = db.insert(projects).values({ path: "/p", name: "p" }).returning({ id: projects.id }).get().id;
  recette = db.insert(projectEnvironments).values({ projectId, name: "Recette", protected: true, urls: [{ label: "site", url: "https://recette.example/" }] }).returning({ id: projectEnvironments.id }).get().id;
});

const input: RequestInput = {
  name: "Create user",
  method: "POST",
  url: "{{baseUrl}}/api/users",
  headers: [
    { name: "Authorization", value: "Bearer {{token}}", secret: true, hasValue: false },
    { name: "Accept", value: "application/json", secret: false, hasValue: false },
  ],
  body: '{"name":"{{who}}"}',
};

const answering = (status = 201, body = '{"id":1}') =>
  vi.fn<Sender>(async () => new Response(body, { status, headers: { "content-type": "application/json", "set-cookie": "session=abc" } }));

describe("saving", () => {
  it("keeps secrets encrypted, never shows them, and keeps one left empty", () => {
    const saved = saveRequest(db, projectId, null, input);
    if (!("id" in saved)) throw new Error(saved.problem);
    const stored = db.select().from(httpRequests).get();
    expect(stored?.headers[0].value).not.toContain("Bearer");
    expect(listHttp(db, projectId).requests[0].headers[0]).toEqual({ name: "Authorization", value: "", secret: true, hasValue: true });
    // As the editor sends it back: the secret's field empty.
    saveRequest(db, projectId, saved.id, { ...input, name: "Renamed", headers: [{ ...input.headers[0], value: "" }, input.headers[1]] });
    expect(db.select().from(httpRequests).get()?.headers[0].value).toBe(stored?.headers[0].value);
  });

  it("refuses what cannot be sent", () => {
    expect(saveRequest(db, projectId, null, { ...input, name: " " })).toEqual({ problem: "nameMissing" });
    expect(saveRequest(db, projectId, null, { ...input, method: "BREW" })).toEqual({ problem: "methodInvalid" });
    expect(saveRequest(db, projectId, null, { ...input, headers: [{ name: "Bad Name", value: "x", secret: false, hasValue: false }] })).toEqual({ problem: "headerInvalid" });
  });
});

describe("sending", () => {
  it("replaces the variables, takes baseUrl from the environment, and keeps the answer without secrets", async () => {
    const saved = saveRequest(db, projectId, null, input);
    if (!("id" in saved)) throw new Error(saved.problem);
    expect(saveVariables(db, projectId, recette, [{ name: "token", value: "t0k", secret: true, hasValue: false }, { name: "who", value: "Ada", secret: false, hasValue: false }])).toBeNull();
    expect(listHttp(db, projectId).environments[1].variables[0]).toEqual({ name: "token", value: "", secret: true, hasValue: true });

    const sender = answering();
    expect(await sendRequest(db, projectId, saved.id, recette, false, sender)).toEqual({ problem: "needsConfirm", detail: "Recette" });
    expect(sender).not.toHaveBeenCalled();

    const sent = await sendRequest(db, projectId, saved.id, recette, true, sender);
    expect(sender).toHaveBeenCalledWith("https://recette.example/api/users", expect.objectContaining({ method: "POST", body: '{"name":"Ada"}', headers: [["Authorization", "Bearer t0k"], ["Accept", "application/json"]] }));
    expect(sent).toMatchObject({ response: { status: 201, body: '{"id":1}', environment: "Recette", url: "https://recette.example/api/users" } });
    if (!("response" in sent)) throw new Error("no response");
    expect(sent.response.headers).toContainEqual(["set-cookie", "••••"]);
    expect(listResponses(db, projectId, saved.id)).toHaveLength(1);
  });

  it("says which variables are missing, and keeps a failed sending", async () => {
    const saved = saveRequest(db, projectId, null, { ...input, method: "GET" });
    if (!("id" in saved)) throw new Error(saved.problem);
    expect(await sendRequest(db, projectId, saved.id, null, false, answering())).toEqual({ problem: "missing", detail: "baseUrl, token" });
    db.insert(httpVariables).values({ projectId, environmentId: null, name: "baseUrl", value: "http://localhost:1", secret: false }).run();
    db.insert(httpVariables).values({ projectId, environmentId: null, name: "token", value: "x", secret: false }).run();
    const down = vi.fn<Sender>(async () => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    });
    expect(await sendRequest(db, projectId, saved.id, null, false, down)).toMatchObject({ response: { status: null, error: "fetch failed: connect ECONNREFUSED" } });
  });
});
