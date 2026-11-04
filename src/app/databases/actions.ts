"use server";

import { isValidDatabaseName } from "@/lib/db-engines";
import { checkReadOnlySql } from "@/lib/sql-guard";
import { listContainerDatabases } from "@/app/dump-actions";
import { getDb } from "@/server/db/client";
import { browseTable, type ColumnInfo, type Conn, listColumns, listTables, type Page, runMongoFind, runSql, type TableInfo } from "@/server/databases";
import { type DatabaseContainer, listDatabaseContainers } from "@/server/dumps/containers";
import { readCredentials } from "@/server/dumps/engines";
import { serverMessages } from "@/server/i18n";
import { clearHistory, type HistoryEntry, listHistory, recordQuery } from "@/server/query-history";
import { revalidatePath } from "next/cache";
import { PAGE_SIZE } from "@/server/databases";
import type { QueryResult } from "@/lib/sql-result";

type Fail = { error: string };

async function connect(
  containerId: string,
  database: string,
): Promise<{ conn: Conn; container: DatabaseContainer; m: ReturnType<typeof serverMessages>["databases"]["errors"] } | Fail> {
  const db = getDb();
  const m = serverMessages(db).databases.errors;
  if (typeof database !== "string" || !isValidDatabaseName(database)) return { error: m.invalidName };
  const { containers, error } = await listDatabaseContainers(db);
  if (error) return { error: m.dockerUnavailable(error) };
  const container = containers.find(({ id }) => id === String(containerId));
  if (!container) return { error: m.containerGone };
  return {
    container,
    m,
    conn: { containerId: container.id, engine: container.engine, credentials: readCredentials(container.engine, container.info.env), database },
  };
}

const failed = (m: { timeout: string; failed: (reason: string) => string }, error: string): Fail => ({
  error: error === "timeout" ? m.timeout : m.failed(error),
});

export async function loadDatabases(containerId: string) {
  return listContainerDatabases(containerId);
}

export async function loadTables(containerId: string, database: string): Promise<{ tables: TableInfo[] } | Fail> {
  const connected = await connect(containerId, database);
  if ("error" in connected) return connected;
  const result = await listTables(connected.conn);
  return "error" in result ? failed(connected.m, result.error) : result;
}

export async function loadColumns(
  containerId: string,
  database: string,
  schema: string | null,
  table: string,
): Promise<{ columns: ColumnInfo[] } | Fail> {
  const connected = await connect(containerId, database);
  if ("error" in connected) return connected;
  try {
    const result = await listColumns(connected.conn, schema, String(table));
    return "error" in result ? failed(connected.m, result.error) : result;
  } catch {
    return { error: connected.m.invalidName };
  }
}

export async function loadPage(
  containerId: string,
  database: string,
  schema: string | null,
  table: string,
  page: number,
): Promise<Page | Fail> {
  const connected = await connect(containerId, database);
  if ("error" in connected) return connected;
  try {
    const result = await browseTable(connected.conn, schema, String(table), Number(page) || 0);
    return "error" in result ? failed(connected.m, result.error) : result;
  } catch {
    return { error: connected.m.invalidName };
  }
}

export type QueryOutput = { result: QueryResult; elapsedMs: number; hasMore: boolean };

function remember(
  container: DatabaseContainer,
  database: string,
  statement: string,
  outcome: { ok: true; result: QueryResult; elapsedMs: number } | { ok: false; error: string },
) {
  recordQuery(getDb(), {
    projectId: container.projectId,
    containerName: container.name,
    database,
    statement,
    ok: outcome.ok,
    rowCount: outcome.ok ? outcome.result.rows.length : null,
    elapsedMs: outcome.ok ? outcome.elapsedMs : 0,
  });
  revalidatePath("/databases");
}

/** The only door to the SQL editor: the text is checked, then the database holds it read-only. */
export async function executeSql(containerId: string, database: string, sql: string): Promise<QueryOutput | Fail> {
  const connected = await connect(containerId, database);
  if ("error" in connected) return connected;
  const { conn, container, m } = connected;
  const checked = checkReadOnlySql(String(sql ?? ""), conn.engine);
  if (!checked.ok) return { error: m[checked.reason] };
  const outcome = await runSql(conn, checked.statement);
  remember(container, database, checked.statement, outcome);
  return outcome.ok ? { result: outcome.result, elapsedMs: outcome.elapsedMs, hasMore: false } : failed(m, outcome.error);
}

/** MongoDB: the filter of one collection, a page at a time. */
export async function executeFilter(
  containerId: string,
  database: string,
  collection: string,
  filter: string,
  page: number,
): Promise<QueryOutput | Fail> {
  const connected = await connect(containerId, database);
  if ("error" in connected) return connected;
  const { conn, container, m } = connected;
  if (conn.engine !== "mongodb" || typeof collection !== "string" || collection === "") return { error: m.invalidName };
  const skip = Math.max(0, Math.floor(Number(page) || 0)) * PAGE_SIZE;
  const outcome = await runMongoFind(conn, collection, String(filter ?? ""), skip, PAGE_SIZE + 1);
  if (!outcome.ok) {
    if (outcome.error === "invalid" || outcome.error === "script") return { error: m[outcome.error] };
    remember(container, database, `${collection}.find(${filter})`, outcome);
    return failed(m, outcome.error);
  }
  if (skip === 0) remember(container, database, `${collection}.find(${String(filter).trim() || "{}"})`, outcome);
  const hasMore = outcome.result.rows.length > PAGE_SIZE;
  return { result: { ...outcome.result, rows: outcome.result.rows.slice(0, PAGE_SIZE) }, elapsedMs: outcome.elapsedMs, hasMore };
}

export async function loadHistory(projectId: number): Promise<HistoryEntry[]> {
  return Number.isInteger(projectId) ? listHistory(getDb(), projectId) : [];
}

export async function clearProjectHistory(projectId: number): Promise<void> {
  if (Number.isInteger(projectId)) clearHistory(getDb(), projectId);
  revalidatePath("/databases");
}

