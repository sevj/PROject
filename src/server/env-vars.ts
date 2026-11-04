import { execFile } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, asc, desc, eq } from "drizzle-orm";
import { en, type Messages } from "@/i18n/en";
import { compareEnv, ENV_KEY, envValues, type EnvRow, parseEnv, writeEnvValue } from "@/lib/env-file";
import type { Db } from "./db/client";
import { envValueHistory } from "./db/schema";
import { MAX_ENV_BYTES } from "./project-files";

const run = promisify(execFile);

/** Declares every variable, and is committed: a name can be added to it, never a value. */
export const DECLARED_ENV_FILE = ".env";
/** What the application actually uses on this machine, and is not committed. */
export const LOCAL_ENV_FILE = ".env.local";

const MAX_VALUE_LENGTH = 64 * 1024;

export type EnvHistoryOrigin = (typeof envValueHistory.$inferSelect)["origin"];

export type EnvHistoryEntry = {
  id: number;
  /** Null when the variable was removed at that point. */
  value: string | null;
  origin: EnvHistoryOrigin;
  savedAt: number;
};

export type EnvView = {
  rows: EnvRow[];
  history: Record<string, EnvHistoryEntry[]>;
  declaredExists: boolean;
  declaredUnreadable: boolean;
  localExists: boolean;
  localUnreadable: boolean;
  /** False when git would offer to commit the local file and its values. */
  localIgnored: boolean;
};

type Source = { exists: boolean; content: string; mode: number | null };

/** Null when the file cannot be trusted to be read in full: a link, too big, or refused. */
function readSource(path: string): Source | null {
  try {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) return { exists: false, content: "", mode: null };
    if (!stat.isFile() || stat.size > MAX_ENV_BYTES) return null;
    return { exists: true, content: readFileSync(path, "utf8"), mode: stat.mode & 0o7777 };
  } catch {
    return null;
  }
}

/** The file is whole at any moment, even if the machine stops during the write. */
function replaceFile(path: string, content: string, mode: number | null) {
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, content, { flag: "wx", mode: 0o666 });
    if (mode !== null) chmodSync(temporary, mode);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

async function isIgnored(projectPath: string, file: string): Promise<boolean> {
  try {
    await run("git", ["-c", "core.fsmonitor=false", "check-ignore", "-q", file], { cwd: projectPath, timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function historyOf(db: Db, projectId: number): Record<string, EnvHistoryEntry[]> {
  const entries = db
    .select()
    .from(envValueHistory)
    .where(eq(envValueHistory.projectId, projectId))
    .orderBy(asc(envValueHistory.key), desc(envValueHistory.id))
    .all();
  const history: Record<string, EnvHistoryEntry[]> = {};
  for (const { id, key, value, origin, savedAt } of entries) {
    (history[key] ??= []).push({ id, value, origin, savedAt: savedAt.getTime() });
  }
  return history;
}

export async function readEnvView(db: Db, projectId: number, projectPath: string, hasGit: boolean): Promise<EnvView> {
  const declared = readSource(join(projectPath, DECLARED_ENV_FILE));
  const local = readSource(join(projectPath, LOCAL_ENV_FILE));
  const history = historyOf(db, projectId);
  return {
    rows: compareEnv(parseEnv(declared?.content ?? ""), parseEnv(local?.content ?? ""), Object.keys(history)),
    history,
    declaredExists: declared?.exists ?? true,
    declaredUnreadable: declared === null,
    localExists: local?.exists ?? true,
    localUnreadable: local === null,
    localIgnored: !hasGit || (await isIgnored(projectPath, LOCAL_ENV_FILE)),
  };
}

/**
 * The file and the history change together or not at all. All of it is synchronous, so two
 * saves cannot read the same content and have the second one undo the first.
 *
 * The current value is kept first when the history does not have it yet: it is about to be
 * overwritten, and it was never saved from here if it was the first edit or a change by hand.
 */
function applyValue(
  db: Db,
  projectId: number,
  projectPath: string,
  key: string,
  value: string | null,
  origin: EnvHistoryOrigin,
  m: Messages["envTab"],
): string | null {
  const path = join(projectPath, LOCAL_ENV_FILE);
  const source = readSource(path);
  if (!source) return m.unreadable(LOCAL_ENV_FILE);

  const current = envValues(parseEnv(source.content)).get(key) ?? null;
  if (current === value) return null;

  const next = writeEnvValue(source.content, key, value);
  if (next === null) return m.cannotWrite(key);
  if (Buffer.byteLength(next) > MAX_ENV_BYTES) return m.tooLarge;

  try {
    if (source.exists) accessSync(path, constants.W_OK);
    db.transaction((tx) => {
      const latest = tx
        .select({ value: envValueHistory.value })
        .from(envValueHistory)
        .where(and(eq(envValueHistory.projectId, projectId), eq(envValueHistory.key, key)))
        .orderBy(desc(envValueHistory.id))
        .limit(1)
        .get();
      if (latest ? latest.value !== current : current !== null) {
        tx.insert(envValueHistory).values({ projectId, key, value: current, origin: "file" }).run();
      }
      tx.insert(envValueHistory).values({ projectId, key, value, origin }).run();
      replaceFile(path, next, source.mode);
    });
    return null;
  } catch {
    // The reason may quote the file, never a value: it is left out all the same.
    return m.notWritable(LOCAL_ENV_FILE);
  }
}

export function saveEnvValue(
  db: Db,
  projectId: number,
  projectPath: string,
  key: string,
  value: string | null,
  m: Messages["envTab"] = en.envTab,
): string | null {
  if (!ENV_KEY.test(key)) return m.invalidKey;
  if (value !== null && (value.length > MAX_VALUE_LENGTH || value.includes("\0"))) return m.invalidValue;
  return applyValue(db, projectId, projectPath, key, value, "edit", m);
}

/**
 * Adds a name to the file that is committed, always without a value: what the local file
 * holds may be a secret. Does nothing to a name already declared, whatever its value.
 */
export function declareEnvVariable(projectPath: string, key: string, m: Messages["envTab"] = en.envTab): string | null {
  if (!ENV_KEY.test(key)) return m.invalidKey;
  const path = join(projectPath, DECLARED_ENV_FILE);
  const source = readSource(path);
  if (!source) return m.unreadable(DECLARED_ENV_FILE);
  if (envValues(parseEnv(source.content)).has(key)) return null;
  const next = writeEnvValue(source.content, key, "");
  if (next === null) return m.cannotWrite(key);
  if (Buffer.byteLength(next) > MAX_ENV_BYTES) return m.tooLarge;
  try {
    if (source.exists) accessSync(path, constants.W_OK);
    replaceFile(path, next, source.mode);
    return null;
  } catch {
    return m.notWritable(DECLARED_ENV_FILE);
  }
}

/** The entry is looked up in this project: its id comes from the browser. */
export function restoreEnvValue(
  db: Db,
  projectId: number,
  projectPath: string,
  entryId: number,
  m: Messages["envTab"] = en.envTab,
): string | null {
  const entry = db
    .select()
    .from(envValueHistory)
    .where(and(eq(envValueHistory.id, entryId), eq(envValueHistory.projectId, projectId)))
    .get();
  if (!entry) return m.entryGone;
  return applyValue(db, projectId, projectPath, entry.key, entry.value, "restore", m);
}
