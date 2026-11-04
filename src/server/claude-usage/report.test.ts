import { beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db/client";
import { claudeApiCalls, claudeTranscripts, projects } from "../db/schema";
import { readClaudeUsage, USAGE_DAYS, USAGE_WEEKS } from "./report";

const NOW = new Date("2026-11-04T12:00:00Z").getTime();
const DAY = 24 * 3600 * 1000;
const MILLION = 1_000_000;

let db: Db;
let projectId: number;
let sequence = 0;

const addProject = (path: string, parentId: number | null = null) =>
  db.insert(projects).values({ path, name: path, parentId }).returning({ id: projects.id }).get().id;

const addCall = (overrides: Partial<typeof claudeApiCalls.$inferInsert> = {}) => {
  sequence += 1;
  db.insert(claudeApiCalls)
    .values({
      messageId: `msg_${sequence}`,
      sessionId: "session-1",
      projectId,
      cwd: "/work/app",
      calledAt: new Date(NOW - DAY),
      model: "claude-opus-5-5",
      isSidechain: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      webSearchRequests: 0,
      speed: "standard",
      ...overrides,
    })
    .run();
};

const usage = (id = projectId) => {
  const result = readClaudeUsage(db, id, NOW);
  if (!result) throw new Error("expected usage");
  return result;
};

beforeEach(() => {
  db = openDb(":memory:");
  projectId = addProject("/work/app");
});

describe("readClaudeUsage", () => {
  it("has nothing to say about a project without calls", () => {
    expect(readClaudeUsage(db, projectId, NOW)).toBeNull();
  });

  it("adds up tokens, calls and sessions", () => {
    addCall({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWrite5mTokens: 4, cacheWrite1hTokens: 5 });
    addCall({ outputTokens: 10, sessionId: "session-2" });
    expect(usage()).toMatchObject({
      calls: 2,
      inputTokens: 1,
      outputTokens: 12,
      cacheReadTokens: 3,
      cacheWriteTokens: 9,
    });
    expect(usage().sessions).toHaveLength(2);
  });

  it("tells apart what each kind of token cost", () => {
    addCall({
      inputTokens: MILLION,
      outputTokens: MILLION,
      cacheReadTokens: MILLION,
      cacheWrite5mTokens: MILLION,
      cacheWrite1hTokens: MILLION,
      webSearchRequests: 100,
    });
    const { costByKind, costInDollars, webSearchRequests } = usage();
    expect(costByKind).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 13, webSearch: 1 });
    expect(costInDollars).toBeCloseTo(38.2);
    expect(webSearchRequests).toBe(100);
  });

  it("details the models, most expensive first", () => {
    addCall({ model: "claude-sonnet-5-5", outputTokens: MILLION });
    addCall({ model: "claude-opus-5-5", outputTokens: MILLION });
    addCall({ model: "claude-opus-5-5", outputTokens: MILLION });
    const { models } = usage();
    expect(models.map(({ model, calls, costInDollars }) => [model, calls, costInDollars])).toEqual([
      ["claude-opus-5-5", 2, 40],
      ["claude-sonnet-5-5", 1, 10],
    ]);
  });

  it("details the sessions, most recent first", () => {
    addCall({ sessionId: "old", outputTokens: MILLION, calledAt: new Date(NOW - 10 * DAY) });
    addCall({ sessionId: "old", model: "claude-sonnet-5-5", calledAt: new Date(NOW - 9 * DAY) });
    addCall({ sessionId: "new", outputTokens: MILLION, isSidechain: true, calledAt: new Date(NOW - DAY) });
    const [recent, older] = usage().sessions;
    expect(recent).toMatchObject({ sessionId: "new", subagentCostInDollars: 20, lastCallAt: NOW - DAY });
    expect(older).toMatchObject({
      sessionId: "old",
      calls: 2,
      firstCallAt: NOW - 10 * DAY,
      lastCallAt: NOW - 9 * DAY,
      models: ["claude-opus-5-5", "claude-sonnet-5-5"],
    });
  });

  it("details the folders, most expensive first", () => {
    addCall({ cwd: "/work/app/src", model: "claude-sonnet-5-5", outputTokens: MILLION });
    addCall({ cwd: "/work/app", outputTokens: MILLION });
    expect(usage().folders.map(({ cwd, costInDollars }) => [cwd, costInDollars])).toEqual([
      ["/work/app", 20],
      ["/work/app/src", 10],
    ]);
  });

  it("spreads the cost over the days, oldest first", () => {
    addCall({ outputTokens: MILLION, calledAt: new Date(NOW - 3600 * 1000) });
    addCall({ outputTokens: MILLION, calledAt: new Date(NOW - 2 * DAY - 3600 * 1000) });
    addCall({ outputTokens: MILLION, calledAt: new Date(NOW - 40 * DAY) });
    const { dailyCost } = usage();
    expect(dailyCost).toHaveLength(USAGE_DAYS);
    expect(dailyCost.at(-1)).toBeCloseTo(20);
    expect(dailyCost.at(-3)).toBeCloseTo(20);
    expect(dailyCost.reduce((sum, cost) => sum + cost, 0)).toBeCloseTo(40);
  });

  it("prices each model at its own rate", () => {
    addCall({ outputTokens: MILLION });
    addCall({ model: "claude-sonnet-5-5", outputTokens: MILLION });
    expect(usage().costInDollars).toBeCloseTo(20 + 10);
  });

  it("prices each long prompt of Haiku 5.5 on its own", () => {
    addCall({ model: "claude-haiku-5-5", inputTokens: 60_000, outputTokens: MILLION });
    addCall({ model: "claude-haiku-5-5", inputTokens: 60_000, outputTokens: 0 });
    addCall({ model: "claude-haiku-5-5", inputTokens: 1, cacheReadTokens: 100_000, outputTokens: MILLION });
    // Two short prompts at the low rate, though they add up to more than the threshold.
    const low = (120_000 * 0.1 + MILLION * 0.5) / MILLION;
    const high = (1 * 0.5 + 100_000 * 0.05 + MILLION * 2.5) / MILLION;
    expect(usage().costInDollars).toBeCloseTo(low + high, 6);
  });

  it("leaves out of the cost what has no known price, and says so", () => {
    addCall({ outputTokens: MILLION });
    addCall({ model: "claude-future-9", outputTokens: MILLION });
    expect(usage()).toMatchObject({
      costInDollars: 20,
      calls: 2,
      outputTokens: 2 * MILLION,
      unpricedCalls: 1,
      unpricedModels: ["claude-future-9"],
    });
  });

  it("isolates what subagents cost", () => {
    addCall({ outputTokens: MILLION });
    addCall({ outputTokens: MILLION, isSidechain: true });
    const { costInDollars, subagentCostInDollars } = usage();
    expect(costInDollars).toBeCloseTo(40);
    expect(subagentCostInDollars).toBeCloseTo(20);
  });

  it("spreads the cost over the weeks, oldest first, and keeps the older in the total", () => {
    addCall({ outputTokens: MILLION, calledAt: new Date(NOW - DAY) });
    addCall({ outputTokens: MILLION, calledAt: new Date(NOW - 8 * DAY) });
    addCall({ outputTokens: MILLION, calledAt: new Date(NOW - 400 * DAY) });
    const { weeklyCost, costInDollars } = usage();
    expect(weeklyCost).toHaveLength(USAGE_WEEKS);
    expect(weeklyCost.at(-1)).toBeCloseTo(20);
    expect(weeklyCost.at(-2)).toBeCloseTo(20);
    expect(weeklyCost.reduce((sum, cost) => sum + cost, 0)).toBeCloseTo(40);
    expect(costInDollars).toBeCloseTo(60);
  });

  it("puts a call dated in the future in the current week", () => {
    addCall({ outputTokens: MILLION, calledAt: new Date(NOW + DAY) });
    expect(usage().weeklyCost.at(-1)).toBeCloseTo(20);
  });

  it("does not mix projects up", () => {
    const other = addProject("/work/other");
    addCall({ outputTokens: MILLION, projectId: other });
    expect(readClaudeUsage(db, projectId, NOW)).toBeNull();
  });

  it("shows on a group what its sub-projects did", () => {
    const group = addProject("/work/group");
    addCall({ outputTokens: MILLION, projectId: addProject("/work/group/a", group) });
    addCall({ outputTokens: MILLION, projectId: addProject("/work/group/b", group) });
    expect(usage(group).costInDollars).toBeCloseTo(40);
  });

  it("reports the unreadable lines of the transcripts", () => {
    addCall();
    db.insert(claudeTranscripts).values({ path: "/a.jsonl", offset: 0, unreadableLines: 2 }).run();
    db.insert(claudeTranscripts).values({ path: "/b.jsonl", offset: 0, unreadableLines: 1 }).run();
    expect(usage().unreadableLines).toBe(3);
  });
});
