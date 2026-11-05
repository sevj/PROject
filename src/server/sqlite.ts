import { execFile } from "node:child_process";
import { closeSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { and, eq } from "drizzle-orm";
import type { Plan } from "@/lib/explain";
import { parseSqlitePlan } from "@/lib/explain";
import { quoteIdentifier } from "@/lib/sql-guard";
import { ROW_LIMIT, type QueryResult } from "@/lib/sql-result";
import type { Db } from "./db/client";
import { type ColumnInfo, PAGE_SIZE, QUERY_TIMEOUT_S, type TableInfo } from "./databases";
import { projectMeta, projects } from "./db/schema";
import { getProject } from "./registry";

/** A SQLite file in a project, as the Databases page lists it. */
export type SqliteTarget = {
  id: string;
  name: string;
  service: string;
  image: string;
  engine: "sqlite";
  projectId: number;
  projectName: string;
};

const EXTENSIONS = /\.(db|db3|sqlite|sqlite3)$/i;
const HEADER = "SQLite format 3\0";
/** Folders that hold dependencies, caches or build output, never a project's own data. */
const SKIPPED = new Set(["node_modules", ".git", "vendor", "var", ".next", "dist", "build", "target", ".cache", ".venv", "venv", "__pycache__", "coverage"]);
const MAX_DEPTH = 5;
const MAX_VISITED = 4000;

const ID = /^sqlite:(\d+):(.+)$/;
export const isSqliteId = (id: unknown): id is string => typeof id === "string" && ID.test(id);

function hasSqliteHeader(file: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(file, "r");
    const buffer = Buffer.alloc(HEADER.length);
    return readSync(fd, buffer, 0, buffer.length, 0) === HEADER.length && buffer.toString("latin1") === HEADER;
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Paths relative to the project, symbolic links not followed. */
export function findSqliteFiles(root: string): string[] {
  const found: string[] = [];
  let visited = 0;
  const walk = (directory: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (++visited > MAX_VISITED) return;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIPPED.has(entry.name)) walk(full, depth + 1);
      } else if (entry.isFile() && EXTENSIONS.test(entry.name) && hasSqliteHeader(full)) {
        found.push(relative(root, full));
      }
    }
  };
  walk(root, 0);
  return found.sort((a, b) => a.localeCompare(b, "fr"));
}

export function listSqliteTargets(db: Db): SqliteTarget[] {
  const known = db
    .select({ id: projects.id, path: projects.path, name: projects.name, displayName: projectMeta.displayName })
    .from(projects)
    .leftJoin(projectMeta, eq(projectMeta.projectId, projects.id))
    .where(and(eq(projects.kind, "project"), eq(projects.abandoned, false)))
    .all();
  const targets: SqliteTarget[] = [];
  for (const project of known) {
    const found = getProject(db, project.id);
    if (!found || found.row.missing) continue;
    for (const file of findSqliteFiles(found.absolutePath)) {
      targets.push({
        id: `sqlite:${project.id}:${file}`,
        name: file,
        service: "file",
        image: "sqlite",
        engine: "sqlite",
        projectId: project.id,
        projectName: project.displayName ?? project.name,
      });
    }
  }
  return targets.sort((a, b) => a.projectName.localeCompare(b.projectName, "fr") || a.name.localeCompare(b.name, "fr"));
}

export type SqliteFile = { file: string; projectId: number; name: string };

/** The browser names a file by project and relative path; it must really be a SQLite file inside that project. */
export function resolveSqlite(db: Db, id: string): SqliteFile | null {
  const match = ID.exec(id);
  if (!match) return null;
  const projectId = Number(match[1]);
  const name = match[2];
  const project = getProject(db, projectId);
  if (!project || project.row.missing || project.row.abandoned || !EXTENSIONS.test(name) || name.includes("\0")) return null;
  try {
    const root = realpathSync(project.absolutePath);
    const file = realpathSync(join(root, name));
    if (!file.startsWith(root + sep) || !statSync(file).isFile() || !hasSqliteHeader(file)) return null;
    return { file, projectId, name };
  } catch {
    return null;
  }
}

/**
 * Runs in a child process of its own: a query that never ends is killed from outside, which
 * the library cannot do. The file is opened read-only and the session refuses writes as well.
 */
const SCRIPT = `
const [, file, sql, limitText] = process.argv;
const limit = Number(limitText);
const out = (value) => process.stdout.write(JSON.stringify(value));
const cell = (value) =>
  value === null ? null : Buffer.isBuffer(value) ? "<blob " + value.length + " bytes>" : typeof value === "string" ? value : String(value);
try {
  const Database = require("better-sqlite3");
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  const statement = db.prepare(sql);
  if (!statement.reader) {
    out({ error: "notReadOnly" });
  } else {
    const columns = statement.columns().map((column) => column.name);
    statement.raw(true);
    const rows = [];
    let truncated = false;
    for (const row of statement.iterate()) {
      if (rows.length >= limit) { truncated = true; break; }
      rows.push(row.map(cell));
    }
    out({ columns, rows, truncated });
  }
} catch (error) {
  out({ error: String((error && error.message) || error) });
}
`;

export type SqliteOutcome = { ok: true; result: QueryResult; elapsedMs: number } | { ok: false; error: string };

/** The statement has already been through `checkSqliteSql` (or is built here). */
export function runSqlite(file: string, sql: string, limit = ROW_LIMIT): Promise<SqliteOutcome> {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["-e", SCRIPT, file, sql, String(limit)],
      { timeout: QUERY_TIMEOUT_S * 1000, killSignal: "SIGKILL", maxBuffer: 64 << 20, cwd: process.cwd() },
      (error, stdout, stderr) => {
        if (error && (error as { killed?: boolean }).killed) return resolve({ ok: false, error: "timeout" });
        try {
          const parsed = JSON.parse(stdout) as { error?: string } & Partial<QueryResult>;
          if (parsed.error !== undefined) return resolve({ ok: false, error: parsed.error });
          resolve({
            ok: true,
            result: { columns: parsed.columns ?? [], rows: parsed.rows ?? [], truncated: parsed.truncated === true },
            elapsedMs: Date.now() - started,
          });
        } catch {
          resolve({ ok: false, error: stderr.trim().split("\n").slice(-4).join("\n") || error?.message || "unreadable" });
        }
      },
    );
  });
}

const quote = (name: string) => quoteIdentifier(name, "postgres");

/** A table-valued function takes its argument as a string, not as a name. */
const literal = (value: string) => {
  if (value === "" || /\0/.test(value)) throw new Error("Invalid name");
  return `'${value.replaceAll("'", "''")}'`;
};

export async function listSqliteTables(file: string): Promise<{ tables: TableInfo[] } | { error: string }> {
  const outcome = await runSqlite(file, "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name");
  if (!outcome.ok) return outcome;
  return {
    tables: outcome.result.rows.map(([name, type]) => ({ schema: null, name: name ?? "", kind: type === "view" ? "view" : "table", estimatedRows: null })),
  };
}

export async function listSqliteColumns(file: string, table: string): Promise<{ columns: ColumnInfo[] } | { error: string }> {
  const outcome = await runSqlite(file, `SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(${literal(table)}) ORDER BY cid`);
  if (!outcome.ok) return outcome;
  return {
    columns: outcome.result.rows.map(([name, type, notNull, defaultValue, pk]) => ({
      name: name ?? "",
      type: type ?? "",
      nullable: notNull !== "1",
      defaultValue,
      key: pk && pk !== "0" ? "PRI" : null,
    })),
  };
}

export async function browseSqliteTable(file: string, table: string, page: number) {
  const offset = Math.max(0, Math.floor(page)) * PAGE_SIZE;
  const outcome = await runSqlite(file, `SELECT * FROM ${quote(table)} LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`);
  if (!outcome.ok) return outcome;
  const hasMore = outcome.result.rows.length > PAGE_SIZE;
  return { ok: true as const, result: { ...outcome.result, rows: outcome.result.rows.slice(0, PAGE_SIZE) }, hasMore, elapsedMs: outcome.elapsedMs };
}

export async function explainSqlite(file: string, statement: string): Promise<{ ok: true; plan: Plan; elapsedMs: number } | { ok: false; error: string }> {
  const outcome = await runSqlite(file, `EXPLAIN QUERY PLAN ${statement}`);
  if (!outcome.ok) return outcome;
  const plan = parseSqlitePlan(outcome.result.rows);
  return plan ? { ok: true, plan, elapsedMs: outcome.elapsedMs } : { ok: false, error: "unreadable" };
}
