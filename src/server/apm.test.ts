import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ApmGet,
  type ApmTokenCheck,
  getApmAccount,
  listApmProjects,
  normalizeApmUrl,
  readApmTickets,
  readTicketsQuery,
  removeApmConnection,
  saveApmConnection,
} from "./apm";
import { type Db, openDb } from "./db/client";
import { getSettings, saveSettings } from "./settings";

let dir: string;
let db: Db;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-apm-"));
  process.env.PM_SECRET_KEY_PATH = join(dir, "secret.key");
});
afterAll(() => {
  delete process.env.PM_SECRET_KEY_PATH;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  db = openDb(":memory:");
});

const accepting = vi.fn<ApmTokenCheck>(async () => ({ user: "Jordan Heussler", userId: 36 }));
const QUERY = { state: "open", assignee: "all", search: "", page: 1 } as const;

const PROJECT = { id: 665, name: "ANFR - Refonte", active: true, client: "ANFR" };
const TASK = {
  id: 97181,
  type: "ticket",
  title: "Migration des données",
  status: { id: 8, label: "À affecter", weight: 10, closed: false },
  priority: 3,
  priority_label: "High",
  assigned_to: { id: 36, name: "Jordan Heussler" },
  created: "2026-11-05T20:03:34+01:00",
  updated: "2026-11-05T20:03:34+01:00",
  url: "https://apm.adimeo.com/tasks/view/97181",
};

async function connected() {
  await saveApmConnection(db, "apm.adimeo.com", "apm_pat_secret", accepting);
}

describe("normalizeApmUrl", () => {
  it("keeps the HTTPS origin of an address", () => {
    expect(normalizeApmUrl(" apm.adimeo.com ")).toBe("https://apm.adimeo.com");
    expect(normalizeApmUrl("https://apm.dev.local/my-account/api-tokens")).toBe("https://apm.dev.local");
  });

  it("refuses plain HTTP, credentials in the address and what is not an address", () => {
    expect(normalizeApmUrl("http://apm.adimeo.com")).toBeNull();
    expect(normalizeApmUrl("https://user:pass@apm.adimeo.com")).toBeNull();
    expect(normalizeApmUrl("localhost")).toBeNull();
    expect(normalizeApmUrl("")).toBeNull();
  });
});

describe("saveApmConnection", () => {
  it("keeps the token encrypted and never shows it", async () => {
    expect(await saveApmConnection(db, "https://apm.adimeo.com/", " apm_pat_secret ", accepting)).toEqual({ url: "https://apm.adimeo.com", user: "Jordan Heussler" });
    expect(accepting).toHaveBeenLastCalledWith("https://apm.adimeo.com", "apm_pat_secret");
    expect(JSON.stringify(getSettings(db))).not.toContain("apm_pat_secret");
    expect(getApmAccount(db)).toEqual({ url: "https://apm.adimeo.com", user: "Jordan Heussler", savedAt: expect.any(Number) });
  });

  it("keeps nothing that APM refuses or that is mistyped", async () => {
    expect(await saveApmConnection(db, "apm.adimeo.com", "apm_pat_x", async () => ({ problem: "refused" }))).toEqual({ problem: "refused" });
    expect(await saveApmConnection(db, "http://apm.adimeo.com", "apm_pat_x", accepting)).toEqual({ problem: "url" });
    expect(await saveApmConnection(db, "apm.adimeo.com", "apm pat", accepting)).toEqual({ problem: "token" });
    expect(getApmAccount(db)).toBeNull();
  });

  it("is forgotten when removed", async () => {
    await connected();
    removeApmConnection(db);
    expect(getApmAccount(db)).toBeNull();
  });
});

describe("listApmProjects", () => {
  it("says when there is no token, or one that can no longer be read", async () => {
    expect(await listApmProjects(db)).toEqual({ problem: "noToken", url: null });
    saveSettings(db, { apm: { url: "https://apm.adimeo.com", user: "x", tokenSecret: "v1:broken", savedAt: 0 } });
    expect(await listApmProjects(db)).toEqual({ problem: "unreadableToken", url: "https://apm.adimeo.com" });
  });

  it("lists active projects first, by name, with the token as a bearer", async () => {
    await connected();
    const get = vi.fn<ApmGet>(async () => ({
      status: 200,
      body: { items: [{ id: 2, name: "Old", active: false, client: null }, { id: 3, name: "Zeta", active: true, client: "Z" }, { id: 1, name: "Alpha", active: true, client: "A" }, { broken: true }] },
    }));
    const read = await listApmProjects(db, get);
    expect(get).toHaveBeenCalledWith("https://apm.adimeo.com", "apm_pat_secret", "/projects");
    expect(read).toEqual({ projects: [{ id: 1, name: "Alpha", active: true, client: "A" }, { id: 3, name: "Zeta", active: true, client: "Z" }, { id: 2, name: "Old", active: false, client: null }] });
  });

  it("tells a refused token from an unreachable APM", async () => {
    await connected();
    expect(await listApmProjects(db, async () => ({ status: 401, body: null }))).toEqual({ problem: "refused", url: "https://apm.adimeo.com" });
    expect(await listApmProjects(db, async () => Promise.reject(new Error("ECONNREFUSED")))).toEqual({ problem: "unreachable", url: "https://apm.adimeo.com" });
  });
});

describe("readApmTickets", () => {
  it("reads the project and a page of its tickets", async () => {
    await connected();
    const get = vi.fn<ApmGet>(async (_url, _token, path) =>
      path === "/projects/665" ? { status: 200, body: PROJECT } : { status: 200, body: { items: [TASK], page: 2, limit: 50, total: 74 } },
    );
    const view = await readApmTickets(db, 665, { state: "closed", assignee: "me", search: "migration", page: 2 }, get);
    expect(get).toHaveBeenCalledWith("https://apm.adimeo.com", "apm_pat_secret", "/projects/665/tasks?state=closed&page=2&limit=50&assignee=me&search=migration");
    expect(get).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "/me");
    expect(view).toMatchObject({ project: PROJECT, meId: 36, total: 74, page: 2, pages: 2 });
    expect("tickets" in view && view.tickets).toEqual([
      {
        id: 97181,
        type: "ticket",
        title: "Migration des données",
        status: "À affecter",
        statusWeight: 10,
        closed: false,
        priority: 3,
        priorityLabel: "High",
        assignee: { id: 36, name: "Jordan Heussler" },
        createdAt: Date.parse("2026-11-05T20:03:34+01:00"),
        updatedAt: Date.parse("2026-11-05T20:03:34+01:00"),
        url: "https://apm.adimeo.com/tasks/view/97181",
      },
    ]);
  });

  it("asks APM once who owns a token saved before that was kept", async () => {
    await connected();
    const older = { ...getSettings(db).apm! };
    delete older.userId;
    saveSettings(db, { apm: older });
    const get = vi.fn<ApmGet>(async (_url, _token, path) =>
      path === "/me" ? { status: 200, body: { id: 36 } } : path === "/projects/665" ? { status: 200, body: PROJECT } : { status: 200, body: { items: [], total: 0 } },
    );
    expect(await readApmTickets(db, 665, QUERY, get)).toMatchObject({ meId: 36 });
    await readApmTickets(db, 665, QUERY, get);
    expect(get.mock.calls.filter(([, , path]) => path === "/me")).toHaveLength(1);
    expect(getSettings(db).apm?.userId).toBe(36);
  });

  it("leaves out a ticket whose link is not an HTTPS one", async () => {
    await connected();
    const get: ApmGet = async (_url, _token, path) =>
      path === "/projects/665" ? { status: 200, body: PROJECT } : { status: 200, body: { items: [{ ...TASK, url: "javascript:alert(1)" }], total: 1 } };
    const view = await readApmTickets(db, 665, QUERY, get);
    expect("tickets" in view && view.tickets).toEqual([]);
  });

  it("says when APM does not show this project to the token", async () => {
    await connected();
    expect(await readApmTickets(db, 1, QUERY, async () => ({ status: 404, body: null }))).toEqual({ problem: "notFound", url: "https://apm.adimeo.com" });
  });
});

describe("readTicketsQuery", () => {
  it("falls back to the first page of open tickets", () => {
    expect(readTicketsQuery({})).toEqual(QUERY);
    expect(readTicketsQuery({ state: "nope", assignee: "36", page: "-3", q: ["a"] })).toEqual(QUERY);
    expect(readTicketsQuery({ state: "all", assignee: "me", page: "4", q: "  bug " })).toEqual({ state: "all", assignee: "me", search: "bug", page: 4 });
  });
});
