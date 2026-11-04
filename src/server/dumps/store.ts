import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { desc, eq } from "drizzle-orm";
import { DUMP_EXTENSION, type Engine } from "@/lib/db-engines";
import type { DumpRow } from "@/lib/dumps";
import { type Db, defaultDbPath } from "../db/client";
import { dumps } from "../db/schema";

export type DumpRecord = typeof dumps.$inferSelect;

export const toDumpRow = (record: DumpRecord): DumpRow => ({
  id: record.id,
  projectId: record.projectId,
  projectName: record.projectName,
  containerName: record.containerName,
  engine: record.engine,
  database: record.database,
  fileName: record.fileName,
  sizeBytes: record.sizeBytes,
  rawBytes: record.rawBytes,
  status: record.status,
  error: record.error,
  note: record.note,
  createdAt: record.createdAt.getTime(),
});

/** Next to the database, so that one folder is all there is to back up. */
export function stashDir(): string {
  return process.env.PM_DUMPS_DIR || join(dirname(process.env.PM_DB_PATH || defaultDbPath()), "dumps");
}

export function slug(value: string): string {
  const clean = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
  return clean || "x";
}

const pad = (value: number) => String(value).padStart(2, "0");

export function dumpFileName(input: {
  projectName: string;
  containerName: string;
  database: string | null;
  engine: Engine;
  at: Date;
}): string {
  const stamp = `${input.at.getFullYear()}${pad(input.at.getMonth() + 1)}${pad(input.at.getDate())}-${pad(input.at.getHours())}${pad(input.at.getMinutes())}${pad(input.at.getSeconds())}`;
  return `${slug(input.projectName)}/${slug(input.containerName)}-${slug(input.database ?? "all")}-${stamp}.${DUMP_EXTENSION[input.engine]}.gz`;
}

/** Only ever inside the stash: the name in the database is not trusted with a path. */
export function dumpPath(root: string, fileName: string): string | null {
  const base = resolve(root);
  const full = resolve(base, fileName);
  return full.startsWith(base + sep) ? full : null;
}

export function createDump(
  db: Db,
  root: string,
  input: {
    projectId: number | null;
    projectName: string;
    containerName: string;
    engine: Engine;
    database: string | null;
    note: string | null;
    at?: Date;
  },
): DumpRecord {
  let fileName = dumpFileName({ ...input, at: input.at ?? new Date() });
  const taken = (name: string) =>
    existsSync(join(root, name)) || existsSync(join(root, `${name}.part`)) || db.select().from(dumps).where(eq(dumps.fileName, name)).get() !== undefined;
  for (let attempt = 2; taken(fileName); attempt += 1) {
    fileName = fileName.replace(/(\.[a-z]+\.gz)$/, `-${attempt}$1`);
  }
  return db
    .insert(dumps)
    .values({
      projectId: input.projectId,
      projectName: input.projectName,
      containerName: input.containerName,
      engine: input.engine,
      database: input.database,
      fileName,
      note: input.note,
    })
    .returning()
    .get();
}

export function finishDump(
  db: Db,
  id: number,
  patch: Partial<Pick<DumpRecord, "status" | "error" | "sizeBytes" | "rawBytes">>,
) {
  db.update(dumps)
    .set({ ...patch, finishedAt: new Date() })
    .where(eq(dumps.id, id))
    .run();
}

export const listDumps = (db: Db): DumpRecord[] => db.select().from(dumps).orderBy(desc(dumps.id)).all();

export const getDump = (db: Db, id: number): DumpRecord | undefined => db.select().from(dumps).where(eq(dumps.id, id)).get();

export function setDumpNote(db: Db, id: number, note: string) {
  db.update(dumps)
    .set({ note: note.trim().slice(0, 500) || null })
    .where(eq(dumps.id, id))
    .run();
}

/** The file goes with its line: a dump is kept, or it is gone. */
export async function removeDump(db: Db, root: string, id: number): Promise<void> {
  const dump = getDump(db, id);
  if (!dump) return;
  const path = dumpPath(root, dump.fileName);
  if (path) await rm(path, { force: true });
  db.delete(dumps).where(eq(dumps.id, id)).run();
}

/** A dump still marked as running when the server starts was cut short by it stopping. */
export async function failStaleDumps(db: Db, root: string, liveIds: Set<number>): Promise<void> {
  for (const dump of db.select().from(dumps).where(eq(dumps.status, "running")).all()) {
    if (liveIds.has(dump.id)) continue;
    const path = dumpPath(root, dump.fileName);
    if (path) await rm(`${path}.part`, { force: true });
    finishDump(db, dump.id, { status: "failed", error: "Interrupted: the server stopped during the dump." });
  }
}
