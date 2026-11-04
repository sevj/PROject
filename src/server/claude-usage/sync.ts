import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { claudeApiCalls, claudeTranscripts, projects } from "../db/schema";
import { type ApiCall, mayHoldCall, parseTranscriptLine, projectForCwd } from "./transcript-line";

/** Enough to keep each write short, which matters since writing blocks the whole app. */
const BATCH_SIZE = 200;
const LINE_BREAK = 10;

export type SyncReport = { filesRead: number; callsRead: number; unreadableLines: number };

export function claudeProjectsDir(): string {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "projects");
}

/** Recursive: what a subagent does is told in its own file, and nowhere else. */
async function listTranscripts(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => join(entry.parentPath, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * The same message is written on several lines and can be met again in another file, so a
 * row is the sum of all its sightings: the highest figure seen for each count.
 */
function saveProgress(db: Db, path: string, calls: readonly ApiCall[], offset: number, unreadableLines: number) {
  const highest = (column: string) => sql.raw(`max(${column}, excluded.${column})`);
  db.transaction((tx) => {
    for (const call of calls) {
      tx.insert(claudeApiCalls)
        .values(call)
        .onConflictDoUpdate({
          target: claudeApiCalls.messageId,
          set: {
            inputTokens: highest("input_tokens"),
            outputTokens: highest("output_tokens"),
            cacheReadTokens: highest("cache_read_tokens"),
            cacheWrite5mTokens: highest("cache_write_5m_tokens"),
            cacheWrite1hTokens: highest("cache_write_1h_tokens"),
            webSearchRequests: highest("web_search_requests"),
          },
        })
        .run();
    }
    tx.insert(claudeTranscripts)
      .values({ path, offset, unreadableLines })
      .onConflictDoUpdate({ target: claudeTranscripts.path, set: { offset, unreadableLines } })
      .run();
  });
}

/** An offset is always just after a line break, in the file it was taken from. */
async function endsALine(path: string, offset: number): Promise<boolean> {
  if (offset === 0) return true;
  const file = await open(path);
  try {
    const { buffer } = await file.read(Buffer.alloc(1), 0, 1, offset - 1);
    return buffer[0] === LINE_BREAK;
  } finally {
    await file.close();
  }
}

async function readTranscript(db: Db, path: string, report: SyncReport): Promise<void> {
  const known = db.select().from(claudeTranscripts).where(eq(claudeTranscripts.path, path)).get();
  const { size } = await stat(path);
  if (known && size === known.offset) return;
  // Claude Code rewrites transcripts, which then may have grown back past what was read.
  // Reading again counts nothing twice.
  const restart = !known || size < known.offset || !(await endsALine(path, known.offset));
  let offset = restart ? 0 : known.offset;
  let unreadable = restart ? 0 : known.unreadableLines;
  if (size === offset) return;

  report.filesRead += 1;
  let calls: ApiCall[] = [];
  let rest: Buffer = Buffer.alloc(0);

  const flush = () => {
    saveProgress(db, path, calls, offset, unreadable);
    report.callsRead += calls.length;
    calls = [];
  };

  // Up to the size seen above: what is written meanwhile waits for the next pass.
  for await (const chunk of createReadStream(path, { start: offset, end: size - 1 })) {
    const data: Buffer = rest.length > 0 ? Buffer.concat([rest, chunk as Buffer]) : (chunk as Buffer);
    let start = 0;
    for (let end = data.indexOf(LINE_BREAK); end !== -1; end = data.indexOf(LINE_BREAK, start)) {
      const line = data.subarray(start, end);
      start = end + 1;
      offset += line.length + 1;
      if (!mayHoldCall(line)) continue;
      const parsed = parseTranscriptLine(line.toString());
      if (parsed.kind === "call") calls.push(parsed.call);
      else if (parsed.kind === "unreadable") {
        unreadable += 1;
        report.unreadableLines += 1;
      }
      if (calls.length >= BATCH_SIZE) flush();
    }
    rest = data.subarray(start);
  }
  flush();
}

/** Asked at each pass, since projects come and go and a sub-project can be added under a folder. */
function attachToProjects(db: Db): void {
  const registered = db.select({ id: projects.id, path: projects.path }).from(projects).all();
  const cwds = db.selectDistinct({ cwd: claudeApiCalls.cwd }).from(claudeApiCalls).all();
  db.transaction((tx) => {
    for (const { cwd } of cwds) {
      // No match keeps what was there: a project that moved still owns its past.
      const projectId = projectForCwd(cwd, registered);
      if (projectId === null) continue;
      tx.update(claudeApiCalls)
        .set({ projectId })
        .where(
          and(
            eq(claudeApiCalls.cwd, cwd),
            or(isNull(claudeApiCalls.projectId), ne(claudeApiCalls.projectId, projectId)),
          ),
        )
        .run();
    }
  });
}

/** Reads what is new in the transcripts. A file that cannot be read is tried again next time. */
export async function syncClaudeUsage(db: Db, dir = claudeProjectsDir()): Promise<SyncReport> {
  const report: SyncReport = { filesRead: 0, callsRead: 0, unreadableLines: 0 };
  for (const path of await listTranscripts(dir)) {
    try {
      await readTranscript(db, path, report);
    } catch (error) {
      console.warn(`Claude usage: could not read ${path}`, error);
    }
  }
  attachToProjects(db);
  return report;
}
