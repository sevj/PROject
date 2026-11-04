import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

export function defaultDbPath(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(dataHome, "project-manager", "pm.db");
}

export function openDb(path: string): Db {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
  return db;
}

// Survives hot reloads in dev, which would otherwise open one connection per edit.
const holder = globalThis as unknown as { __pmDb?: Db };

/** Opened on first use so that `next build` never touches the database. */
export function getDb(): Db {
  holder.__pmDb ??= openDb(process.env.PM_DB_PATH || defaultDbPath());
  return holder.__pmDb;
}
