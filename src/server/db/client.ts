import { chmodSync, existsSync, mkdirSync } from "node:fs";
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
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  if (path !== ":memory:") keepPrivate(path);
  const db = drizzle(sqlite, { schema });
  applyMigrations(db);
  return db;
}

/** It holds env values in clear and the app's notes. The two companion files of WAL hold the same data. */
function keepPrivate(path: string) {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(file)) chmodSync(file, 0o600);
  }
}

function applyMigrations(db: Db) {
  migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
}

// Survives hot reloads in dev, which would otherwise open one connection per edit.
const holder = globalThis as unknown as { __pmDb?: Db };

/** Opened on first use so that `next build` never touches the database. */
export function getDb(): Db {
  if (holder.__pmDb && process.env.NODE_ENV !== "production") {
    // The connection outlives hot reloads, which can bring a new migration with them.
    applyMigrations(holder.__pmDb);
  }
  holder.__pmDb ??= openDb(process.env.PM_DB_PATH || defaultDbPath());
  return holder.__pmDb;
}
