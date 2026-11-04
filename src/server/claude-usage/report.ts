import { eq, inArray, sql } from "drizzle-orm";
import { type CostBreakdown, costBreakdown, LONG_PROMPT_TOKENS } from "@/lib/claude-pricing";
import type { Db } from "../db/client";
import { claudeApiCalls, claudeTranscripts, projects } from "../db/schema";

export const USAGE_WEEKS = 26;
export const USAGE_DAYS = 30;

const SECONDS_PER_DAY = 24 * 3600;
const DAYS_PER_WEEK = 7;

export type UsageGroup = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** At the API's prices, without the calls whose model has no known price. */
  costInDollars: number;
  unpricedCalls: number;
};

export type ModelUsage = UsageGroup & { model: string };
export type FolderUsage = UsageGroup & { cwd: string };
export type SessionUsage = UsageGroup & {
  sessionId: string;
  firstCallAt: number;
  lastCallAt: number;
  models: string[];
  subagentCostInDollars: number;
};

export type ClaudeUsage = UsageGroup & {
  /** The part of the cost run up by subagents. */
  subagentCostInDollars: number;
  costByKind: CostBreakdown;
  webSearchRequests: number;
  /** Oldest first, the last one being the past 24 hours. */
  dailyCost: number[];
  /** Oldest first, the last one being the past seven days. */
  weeklyCost: number[];
  /** Most expensive first. */
  models: ModelUsage[];
  /** Most recent first. */
  sessions: SessionUsage[];
  /** Most expensive first. */
  folders: FolderUsage[];
  lastCallAt: number;
  unpricedModels: string[];
  /** In all transcripts: a line says which call it held only if it could be read. */
  unreadableLines: number;
};

/** What a group holds is run in its sub-projects, which are what its sheet is about. */
function withSubProjects(db: Db, projectId: number): number[] {
  const children = db.select({ id: projects.id }).from(projects).where(eq(projects.parentId, projectId)).all();
  return [projectId, ...children.map(({ id }) => id)];
}

const emptyGroup = (): UsageGroup => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costInDollars: 0,
  unpricedCalls: 0,
});

function entry<T>(map: Map<string, T>, key: string, create: () => T): T {
  let value = map.get(key);
  if (!value) {
    value = create();
    map.set(key, value);
  }
  return value;
}

const byCost = (a: UsageGroup, b: UsageGroup) => b.costInDollars - a.costInDollars;

export function readClaudeUsage(db: Db, projectId: number, now = Date.now()): ClaudeUsage | null {
  const nowSeconds = Math.floor(now / 1000);
  const promptTokens = sql`${claudeApiCalls.inputTokens} + ${claudeApiCalls.cacheReadTokens} + ${claudeApiCalls.cacheWrite5mTokens} + ${claudeApiCalls.cacheWrite1hTokens}`;
  // Numbers are bound as floats, which would make this a fraction of a day without the cast.
  const daysAgo = sql<number>`max(0, cast((${nowSeconds} - ${claudeApiCalls.calledAt}) / ${SECONDS_PER_DAY} as integer))`;
  const isLongPrompt = sql<number>`${promptTokens} > ${LONG_PROMPT_TOKENS}`;

  // Figures can be added up only within what is charged alike: same model, speed and kind
  // of prompt. Keeping the session, the folder and the day as well makes every view below
  // a sum of the same rows, so they cannot disagree.
  const buckets = db
    .select({
      model: claudeApiCalls.model,
      speed: claudeApiCalls.speed,
      isSidechain: claudeApiCalls.isSidechain,
      sessionId: claudeApiCalls.sessionId,
      cwd: claudeApiCalls.cwd,
      isLongPrompt,
      daysAgo,
      calls: sql<number>`count(*)`,
      firstCallAt: sql<number>`min(${claudeApiCalls.calledAt})`,
      lastCallAt: sql<number>`max(${claudeApiCalls.calledAt})`,
      inputTokens: sql<number>`sum(${claudeApiCalls.inputTokens})`,
      outputTokens: sql<number>`sum(${claudeApiCalls.outputTokens})`,
      cacheReadTokens: sql<number>`sum(${claudeApiCalls.cacheReadTokens})`,
      cacheWrite5mTokens: sql<number>`sum(${claudeApiCalls.cacheWrite5mTokens})`,
      cacheWrite1hTokens: sql<number>`sum(${claudeApiCalls.cacheWrite1hTokens})`,
      webSearchRequests: sql<number>`sum(${claudeApiCalls.webSearchRequests})`,
    })
    .from(claudeApiCalls)
    .where(inArray(claudeApiCalls.projectId, withSubProjects(db, projectId)))
    .groupBy(
      claudeApiCalls.model,
      claudeApiCalls.speed,
      claudeApiCalls.isSidechain,
      claudeApiCalls.sessionId,
      claudeApiCalls.cwd,
      isLongPrompt,
      daysAgo,
    )
    .all();
  if (buckets.length === 0) return null;

  const usage: ClaudeUsage = {
    ...emptyGroup(),
    subagentCostInDollars: 0,
    costByKind: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearch: 0 },
    webSearchRequests: 0,
    dailyCost: Array<number>(USAGE_DAYS).fill(0),
    weeklyCost: Array<number>(USAGE_WEEKS).fill(0),
    models: [],
    sessions: [],
    folders: [],
    lastCallAt: 0,
    unpricedModels: [],
    unreadableLines: unreadableLines(db),
  };
  const models = new Map<string, ModelUsage>();
  const sessions = new Map<string, SessionUsage>();
  const folders = new Map<string, FolderUsage>();

  for (const bucket of buckets) {
    const parts = costBreakdown(bucket, bucket.isLongPrompt ? LONG_PROMPT_TOKENS + 1 : 0);
    const cost = parts ? parts.input + parts.output + parts.cacheRead + parts.cacheWrite + parts.webSearch : 0;
    const session = entry(sessions, bucket.sessionId, () => ({
      ...emptyGroup(),
      sessionId: bucket.sessionId,
      firstCallAt: Number.POSITIVE_INFINITY,
      lastCallAt: 0,
      models: [],
      subagentCostInDollars: 0,
    }));

    const groups: UsageGroup[] = [
      usage,
      session,
      entry(models, bucket.model, () => ({ ...emptyGroup(), model: bucket.model })),
      entry(folders, bucket.cwd, () => ({ ...emptyGroup(), cwd: bucket.cwd })),
    ];
    for (const group of groups) {
      group.calls += bucket.calls;
      group.inputTokens += bucket.inputTokens;
      group.outputTokens += bucket.outputTokens;
      group.cacheReadTokens += bucket.cacheReadTokens;
      group.cacheWriteTokens += bucket.cacheWrite5mTokens + bucket.cacheWrite1hTokens;
      group.costInDollars += cost;
      if (!parts) group.unpricedCalls += bucket.calls;
    }

    session.firstCallAt = Math.min(session.firstCallAt, bucket.firstCallAt * 1000);
    session.lastCallAt = Math.max(session.lastCallAt, bucket.lastCallAt * 1000);
    if (!session.models.includes(bucket.model)) session.models.push(bucket.model);
    usage.lastCallAt = Math.max(usage.lastCallAt, session.lastCallAt);
    usage.webSearchRequests += bucket.webSearchRequests;

    if (!parts) {
      if (!usage.unpricedModels.includes(bucket.model)) usage.unpricedModels.push(bucket.model);
      continue;
    }
    for (const kind of Object.keys(parts) as (keyof CostBreakdown)[]) usage.costByKind[kind] += parts[kind];
    if (bucket.isSidechain) {
      usage.subagentCostInDollars += cost;
      session.subagentCostInDollars += cost;
    }
    if (bucket.daysAgo < USAGE_DAYS) usage.dailyCost[USAGE_DAYS - 1 - bucket.daysAgo] += cost;
    const weeksAgo = Math.floor(bucket.daysAgo / DAYS_PER_WEEK);
    if (weeksAgo < USAGE_WEEKS) usage.weeklyCost[USAGE_WEEKS - 1 - weeksAgo] += cost;
  }

  usage.models = [...models.values()].sort(byCost);
  usage.folders = [...folders.values()].sort(byCost);
  usage.sessions = [...sessions.values()].sort((a, b) => b.lastCallAt - a.lastCallAt);
  return usage;
}

function unreadableLines(db: Db): number {
  const row = db
    .select({ lines: sql<number>`coalesce(sum(${claudeTranscripts.unreadableLines}), 0)` })
    .from(claudeTranscripts)
    .get();
  return row?.lines ?? 0;
}
