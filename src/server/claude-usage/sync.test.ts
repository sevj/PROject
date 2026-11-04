import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db/client";
import { claudeApiCalls, claudeTranscripts, projects } from "../db/schema";
import { syncClaudeUsage } from "./sync";

let dir: string;
let db: Db;

const line = (id: string, output = 10, overrides: Record<string, unknown> = {}) =>
  `${JSON.stringify({
    type: "assistant",
    sessionId: "session-1",
    cwd: "/work/app",
    timestamp: "2026-11-04T21:14:03.341Z",
    message: {
      id,
      model: "claude-opus-5-5",
      usage: { input_tokens: 1, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
    ...overrides,
  })}\n`;

const file = (relative: string) => {
  const path = join(dir, relative);
  mkdirSync(dirname(path), { recursive: true });
  return path;
};
const rows = () => db.select().from(claudeApiCalls).all();
const totalOutput = () => rows().reduce((sum, row) => sum + row.outputTokens, 0);
const addProject = (path: string) =>
  db.insert(projects).values({ path, name: path }).returning({ id: projects.id }).get().id;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-claude-usage-"));
  db = openDb(":memory:");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("syncClaudeUsage", () => {
  it("counts a message once, however many lines repeat it", async () => {
    writeFileSync(file("p/s.jsonl"), line("a") + line("a") + line("a") + line("b", 5));
    await syncClaudeUsage(db, dir);
    expect(rows()).toHaveLength(2);
    expect(totalOutput()).toBe(15);
  });

  it("keeps the highest figure of a message seen several times", async () => {
    writeFileSync(file("p/s.jsonl"), line("a", 40) + line("a", 7));
    await syncClaudeUsage(db, dir);
    expect(totalOutput()).toBe(40);
  });

  it("does not count a message met again in another file", async () => {
    writeFileSync(file("p/s.jsonl"), line("a"));
    writeFileSync(file("p/resumed.jsonl"), line("a") + line("b"));
    await syncClaudeUsage(db, dir);
    expect(rows()).toHaveLength(2);
  });

  it("finds the transcripts of subagents and tells them apart", async () => {
    writeFileSync(file("p/s.jsonl"), line("a"));
    writeFileSync(file("p/s/subagents/agent-1.jsonl"), line("b", 10, { isSidechain: true }));
    await syncClaudeUsage(db, dir);
    const subagent = db.select().from(claudeApiCalls).where(eq(claudeApiCalls.messageId, "b")).get();
    expect(subagent?.isSidechain).toBe(true);
    expect(rows()).toHaveLength(2);
  });

  it("leaves other files alone", async () => {
    writeFileSync(file("p/s/subagents/agent-1.meta.json"), line("a"));
    writeFileSync(file("p/memory/MEMORY.md"), line("b"));
    await syncClaudeUsage(db, dir);
    expect(rows()).toHaveLength(0);
  });

  it("reads only what is new", async () => {
    const path = file("p/s.jsonl");
    writeFileSync(path, line("a"));
    await syncClaudeUsage(db, dir);
    expect((await syncClaudeUsage(db, dir)).filesRead).toBe(0);

    appendFileSync(path, line("b"));
    const report = await syncClaudeUsage(db, dir);
    expect(report).toMatchObject({ filesRead: 1, callsRead: 1 });
    expect(rows()).toHaveLength(2);
  });

  it("waits for the end of a line being written", async () => {
    const path = file("p/s.jsonl");
    const whole = line("b");
    writeFileSync(path, line("a") + whole.slice(0, 40));
    const report = await syncClaudeUsage(db, dir);
    expect(report).toMatchObject({ callsRead: 1, unreadableLines: 0 });

    appendFileSync(path, whole.slice(40));
    expect(await syncClaudeUsage(db, dir)).toMatchObject({ callsRead: 1, unreadableLines: 0 });
    expect(rows()).toHaveLength(2);
  });

  it("keeps offsets right across characters of several bytes", async () => {
    const path = file("p/s.jsonl");
    writeFileSync(path, `${JSON.stringify({ type: "user", text: "é€😀".repeat(50_000) })}\n${line("a")}`);
    await syncClaudeUsage(db, dir);
    appendFileSync(path, line("b"));
    expect(await syncClaudeUsage(db, dir)).toMatchObject({ callsRead: 1, unreadableLines: 0 });
    expect(rows()).toHaveLength(2);
  });

  it("reads a long history through several writes", async () => {
    const lines = Array.from({ length: 1000 }, (_, index) => line(`m${index}`, 1)).join("");
    writeFileSync(file("p/s.jsonl"), lines);
    await syncClaudeUsage(db, dir);
    expect(totalOutput()).toBe(1000);
  });

  it("starts over on a file that shrank, without counting twice", async () => {
    const path = file("p/s.jsonl");
    writeFileSync(path, line("a") + line("b"));
    await syncClaudeUsage(db, dir);
    writeFileSync(path, line("c"));
    await syncClaudeUsage(db, dir);
    expect(rows().map((row) => row.messageId).sort()).toEqual(["a", "b", "c"]);
  });

  it("starts over on a file rewritten past what was read, rather than from the middle of a line", async () => {
    const path = file("p/s.jsonl");
    writeFileSync(path, line("a"));
    await syncClaudeUsage(db, dir);

    writeFileSync(path, `${line("b", 10, { padding: "x".repeat(40) })}${line("c")}`);
    const report = await syncClaudeUsage(db, dir);
    expect(report).toMatchObject({ unreadableLines: 0 });
    expect(rows().map((row) => row.messageId).sort()).toEqual(["a", "b", "c"]);
  });

  it("keeps the calls of a transcript that was purged", async () => {
    const path = file("p/s.jsonl");
    writeFileSync(path, line("a"));
    await syncClaudeUsage(db, dir);
    rmSync(path);
    await syncClaudeUsage(db, dir);
    expect(rows()).toHaveLength(1);
  });

  it("reports the lines it cannot understand, and only once", async () => {
    const path = file("p/s.jsonl");
    writeFileSync(path, `{"type":"assistant","message":{}}\n${line("a")}`);
    expect(await syncClaudeUsage(db, dir)).toMatchObject({ callsRead: 1, unreadableLines: 1 });
    expect(await syncClaudeUsage(db, dir)).toMatchObject({ callsRead: 0, unreadableLines: 0 });
    expect(db.select().from(claudeTranscripts).get()?.unreadableLines).toBe(1);
  });

  it("gets through a folder that does not exist", async () => {
    await expect(syncClaudeUsage(db, join(dir, "nothing"))).resolves.toMatchObject({ filesRead: 0 });
  });

  describe("projects", () => {
    beforeEach(() => writeFileSync(file("p/s.jsonl"), line("a")));
    const projectIdOfCall = () => rows()[0].projectId;

    it("attaches a call to the project of its folder", async () => {
      const id = addProject("/work/app");
      await syncClaudeUsage(db, dir);
      expect(projectIdOfCall()).toBe(id);
    });

    it("keeps a call outside of any project, until one is registered", async () => {
      await syncClaudeUsage(db, dir);
      expect(projectIdOfCall()).toBeNull();

      const id = addProject("/work/app");
      await syncClaudeUsage(db, dir);
      expect(projectIdOfCall()).toBe(id);
    });

    it("moves a call to a sub-project registered later", async () => {
      addProject("/work");
      await syncClaudeUsage(db, dir);
      const id = addProject("/work/app");
      await syncClaudeUsage(db, dir);
      expect(projectIdOfCall()).toBe(id);
    });

    it("leaves a project its past when it moves", async () => {
      const id = addProject("/work/app");
      await syncClaudeUsage(db, dir);
      db.update(projects).set({ path: "/elsewhere/app" }).where(eq(projects.id, id)).run();
      await syncClaudeUsage(db, dir);
      expect(projectIdOfCall()).toBe(id);
    });

    it("keeps the call when its project is removed", async () => {
      const id = addProject("/work/app");
      await syncClaudeUsage(db, dir);
      db.delete(projects).where(eq(projects.id, id)).run();
      expect(rows()[0]).toMatchObject({ projectId: null, cwd: "/work/app" });
    });
  });
});
