import type { Engine } from "@/lib/db-engines";
import { type Plan, parseMysqlPlan, parsePostgresPlan } from "@/lib/explain";
import { checkMongoFilter, quoteTable } from "@/lib/sql-guard";
import { PG_NULL, type QueryResult, parseMongoDocuments, parseMysqlBatch, parsePgCsv } from "@/lib/sql-result";
import { runQuick } from "./dumps/docker-run";
import { type Command, type Credentials, mongoEval, mysqlTool, secretsFor } from "./dumps/engines";

/** Every query is cut off by the database itself after this long. */
export const QUERY_TIMEOUT_S = 15;

export type Conn = { containerId: string; engine: Engine; credentials: Credentials; database: string };

const jsString = (value: string) => JSON.stringify(value);

/** A value written into a statement that is run as text: quotes doubled, backslashes for MySQL. */
export function sqlLiteral(value: string, engine: Engine): string {
  if (/\0/.test(value)) throw new Error("Invalid value");
  const escaped = value.replaceAll("'", "''");
  return `'${engine === "postgres" ? escaped : escaped.replaceAll("\\", "\\\\")}'`;
}

/**
 * The query runs in a session the database itself holds read-only, with its own time limit:
 * whatever the text says, a write is refused by the server and not only by us.
 */
export function sqlCommand({ engine, credentials, database }: Conn, sql: string): Command {
  if (engine === "postgres") {
    return {
      args: ["psql", "-U", credentials.user, "-d", database, "-X", "--csv", "-P", `null=${PG_NULL}`, "-v", "ON_ERROR_STOP=1", "-c", sql],
      secrets: {
        ...secretsFor(engine, credentials),
        PGOPTIONS: `-c default_transaction_read_only=on -c statement_timeout=${QUERY_TIMEOUT_S * 1000}`,
      },
    };
  }
  const limit = engine === "mariadb" ? `max_statement_time=${QUERY_TIMEOUT_S}` : `max_execution_time=${QUERY_TIMEOUT_S * 1000}`;
  return {
    args: mysqlTool(engine, "client", ["-u", credentials.user, "-D", database, "--batch", "-e", `SET SESSION TRANSACTION READ ONLY; SET SESSION ${limit}; ${sql}`]),
    secrets: secretsFor(engine, credentials),
  };
}

export type RunOutcome = { ok: true; result: QueryResult; elapsedMs: number } | { ok: false; error: string };

const OUTPUT_CAP = 1 << 20;

async function run(conn: Conn, command: Command, parse: (stdout: string) => QueryResult): Promise<RunOutcome> {
  const started = Date.now();
  try {
    const out = await runQuick(conn.containerId, command, (QUERY_TIMEOUT_S + 5) * 1000);
    if (out.code === null) return { ok: false, error: "timeout" };
    if (out.code !== 0) {
      return { ok: false, error: out.stderr.trim().split("\n").slice(-4).join("\n") || `exit ${out.code}` };
    }
    const full = out.stdout.length >= OUTPUT_CAP;
    const result = parse(full ? out.stdout.slice(0, out.stdout.lastIndexOf("\n")) : out.stdout);
    return { ok: true, result: full ? { ...result, truncated: true } : result, elapsedMs: Date.now() - started };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The statement has already been through `checkReadOnlySql`. */
export function runSql(conn: Conn, sql: string): Promise<RunOutcome> {
  return run(conn, sqlCommand(conn, sql), conn.engine === "postgres" ? parsePgCsv : parseMysqlBatch);
}

export type ExplainOutcome = { ok: true; plan: Plan; elapsedMs: number } | { ok: false; error: string };

/**
 * The plan of a statement that has already been through `checkExplainableSql`.
 * ANALYZE (PostgreSQL only) really runs it: in the read-only session, with the time limit.
 */
export async function runExplain(conn: Conn, statement: string, analyze: boolean): Promise<ExplainOutcome> {
  if (conn.engine === "mongodb") return { ok: false, error: "unsupported" };
  const postgres = conn.engine === "postgres";
  const sql = postgres
    ? `EXPLAIN (${analyze ? "ANALYZE, BUFFERS, " : ""}FORMAT JSON) ${statement}`
    : `EXPLAIN FORMAT=JSON ${statement}`;
  const outcome = await runSql(conn, sql);
  if (!outcome.ok) return outcome;
  // One cell holds the whole plan, as JSON.
  const cell = outcome.result.rows[0]?.[0] ?? "";
  const plan = postgres ? parsePostgresPlan(cell) : parseMysqlPlan(cell);
  return plan ? { ok: true, plan, elapsedMs: outcome.elapsedMs } : { ok: false, error: "unreadable" };
}

const mongoCommand = (conn: Conn, script: string): Command => ({ args: mongoEval(conn.credentials, script) });

const parseJsonOutput = (stdout: string): QueryResult => parseMongoDocuments(stdout.trim().split("\n").at(-1) ?? "");

/** One page of documents. The filter is parsed here and again by the shell, as a string literal. */
export function runMongoFind(conn: Conn, collection: string, filterText: string, skip: number, limit: number): Promise<RunOutcome> {
  const checked = checkMongoFilter(filterText);
  if (!checked.ok) return Promise.resolve({ ok: false, error: checked.reason });
  const script =
    `const parse = typeof EJSON !== "undefined" ? EJSON.parse : JSON.parse;` +
    `print(JSON.stringify(db.getSiblingDB(${jsString(conn.database)}).getCollection(${jsString(collection)})` +
    `.find(parse(${jsString(checked.filter)})).skip(${Math.max(0, Math.floor(skip))}).limit(${Math.max(1, Math.floor(limit))})` +
    `.maxTimeMS(${QUERY_TIMEOUT_S * 1000}).toArray()))`;
  return run(conn, mongoCommand(conn, script), parseJsonOutput);
}

export type TableInfo = { schema: string | null; name: string; kind: "table" | "view"; estimatedRows: number | null };

const toCount = (value: string | null) => {
  const count = Number(value);
  return value !== null && Number.isFinite(count) && count >= 0 ? Math.round(count) : null;
};

export async function listTables(conn: Conn): Promise<{ tables: TableInfo[] } | { error: string }> {
  if (conn.engine === "mongodb") {
    const script = `const d = db.getSiblingDB(${jsString(conn.database)}); print(JSON.stringify(d.getCollectionInfos().map(function (i) { return { name: i.name, type: i.type, count: d.getCollection(i.name).estimatedDocumentCount() }; })))`;
    const outcome = await run(conn, mongoCommand(conn, script), (stdout) => ({
      columns: ["name", "type", "count"],
      rows: parseMongoDocuments(stdout.trim().split("\n").at(-1) ?? "").rows,
      truncated: false,
    }));
    if (!outcome.ok) return outcome;
    return {
      tables: outcome.result.rows.map(([name, type, count]) => ({
        schema: null,
        name: name ?? "",
        kind: type === "view" ? "view" : "table",
        estimatedRows: toCount(count),
      })),
    };
  }
  const sql =
    conn.engine === "postgres"
      ? "SELECT n.nspname, c.relname, c.relkind, c.reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','v','m','p','f') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast' ORDER BY 1, 2"
      : `SELECT NULL, table_name, table_type, table_rows FROM information_schema.tables WHERE table_schema = ${sqlLiteral(conn.database, conn.engine)} ORDER BY table_name`;
  const outcome = await runSql(conn, sql);
  if (!outcome.ok) return outcome;
  return {
    tables: outcome.result.rows.map(([schema, name, kind, rows]) => ({
      schema: conn.engine === "postgres" ? schema : null,
      name: name ?? "",
      kind: conn.engine === "postgres" ? (kind === "r" || kind === "p" || kind === "f" ? "table" : "view") : kind === "VIEW" ? "view" : "table",
      // PostgreSQL reports -1 for a table nobody has analyzed yet.
      estimatedRows: conn.engine === "postgres" && rows === "-1" ? null : toCount(rows),
    })),
  };
}

export type ColumnInfo = { name: string; type: string; nullable: boolean; defaultValue: string | null; key: string | null };

export async function listColumns(conn: Conn, schema: string | null, table: string): Promise<{ columns: ColumnInfo[] } | { error: string }> {
  if (conn.engine === "mongodb") return { columns: [] };
  const where =
    conn.engine === "postgres"
      ? `table_schema = ${sqlLiteral(schema ?? "public", conn.engine)} AND table_name = ${sqlLiteral(table, conn.engine)}`
      : `table_schema = ${sqlLiteral(conn.database, conn.engine)} AND table_name = ${sqlLiteral(table, conn.engine)}`;
  const sql =
    conn.engine === "postgres"
      ? `SELECT column_name, data_type, is_nullable, column_default, NULL FROM information_schema.columns WHERE ${where} ORDER BY ordinal_position`
      : `SELECT column_name, column_type, is_nullable, column_default, column_key FROM information_schema.columns WHERE ${where} ORDER BY ordinal_position`;
  const outcome = await runSql(conn, sql);
  if (!outcome.ok) return outcome;
  return {
    columns: outcome.result.rows.map(([name, type, nullable, defaultValue, key]) => ({
      name: name ?? "",
      type: type ?? "",
      nullable: nullable === "YES",
      defaultValue,
      key: key || null,
    })),
  };
}

export const PAGE_SIZE = 50;

export type Page = { result: QueryResult; hasMore: boolean; elapsedMs: number };

/** One more row than the page holds, to know whether there is a next page without counting. */
export async function browseTable(conn: Conn, schema: string | null, table: string, page: number): Promise<Page | { error: string }> {
  const offset = Math.max(0, Math.floor(page)) * PAGE_SIZE;
  const outcome =
    conn.engine === "mongodb"
      ? await runMongoFind(conn, table, "{}", offset, PAGE_SIZE + 1)
      : await runSql(conn, `SELECT * FROM ${quoteTable(schema, table, conn.engine)} LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`);
  if (!outcome.ok) return outcome;
  const hasMore = outcome.result.rows.length > PAGE_SIZE;
  return { result: { ...outcome.result, rows: outcome.result.rows.slice(0, PAGE_SIZE) }, hasMore, elapsedMs: outcome.elapsedMs };
}

