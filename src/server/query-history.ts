import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import { queryHistory } from "./db/schema";

export const HISTORY_LIMIT = 100;
const MAX_STATEMENT_CHARS = 20_000;

export type HistoryEntry = {
  id: number;
  containerName: string;
  database: string;
  statement: string;
  ranAt: number;
  ok: boolean;
  rowCount: number | null;
  elapsedMs: number;
};

export function recordQuery(
  db: Db,
  entry: { projectId: number; containerName: string; database: string; statement: string; ok: boolean; rowCount: number | null; elapsedMs: number },
  now = new Date(),
): void {
  db.insert(queryHistory)
    .values({ ...entry, statement: entry.statement.slice(0, MAX_STATEMENT_CHARS), ranAt: now })
    .run();
  // Only the latest ones are kept.
  const stale = db
    .select({ id: queryHistory.id })
    .from(queryHistory)
    .where(eq(queryHistory.projectId, entry.projectId))
    .orderBy(desc(queryHistory.id))
    .limit(1_000_000)
    .offset(HISTORY_LIMIT)
    .all()
    .map(({ id }) => id);
  if (stale.length > 0) db.delete(queryHistory).where(inArray(queryHistory.id, stale)).run();
}

/** Newest first. */
export function listHistory(db: Db, projectId: number, limit = 50): HistoryEntry[] {
  return db
    .select()
    .from(queryHistory)
    .where(eq(queryHistory.projectId, projectId))
    .orderBy(desc(queryHistory.id))
    .limit(limit)
    .all()
    .map((row) => ({
      id: row.id,
      containerName: row.containerName,
      database: row.database,
      statement: row.statement,
      ranAt: row.ranAt.getTime(),
      ok: row.ok,
      rowCount: row.rowCount,
      elapsedMs: row.elapsedMs,
    }));
}

export function clearHistory(db: Db, projectId: number): void {
  db.delete(queryHistory).where(eq(queryHistory.projectId, projectId)).run();
}

export const countHistory = (db: Db, projectId: number): number =>
  db.select({ count: sql<number>`count(*)` }).from(queryHistory).where(eq(queryHistory.projectId, projectId)).get()?.count ?? 0;

/** The history of several projects at once, with the time it was read at. */
export function readHistories(db: Db, projectIds: number[]): { histories: Record<number, HistoryEntry[]>; now: number } {
  return {
    histories: Object.fromEntries([...new Set(projectIds)].map((id) => [id, listHistory(db, id)])),
    now: Date.now(),
  };
}
