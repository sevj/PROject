import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import type { Db } from "../db/client";
import { claudeTranscripts } from "../db/schema";

const MAX_TITLE_LENGTH = 120;
const MARKER = Buffer.from('"ai-title"');
const LINE_BREAK = 10;

// A title sums up what was said, so it never goes in the database: it is read from the
// transcript when asked for, and stays here only until the file changes or the app stops.
const holder = globalThis as unknown as { __pmSessionTitles?: Map<string, { size: number; title: string | null }> };
const known = () => (holder.__pmSessionTitles ??= new Map());

function titleOf(line: Buffer): string | null {
  try {
    const entry: unknown = JSON.parse(line.toString());
    const { type, aiTitle } = entry as { type?: unknown; aiTitle?: unknown };
    return type === "ai-title" && typeof aiTitle === "string" && aiTitle.trim() ? aiTitle.trim().slice(0, MAX_TITLE_LENGTH) : null;
  } catch {
    return null;
  }
}

/** The last title of a transcript, which is written again as the conversation goes on. */
async function readTitle(path: string): Promise<string | null> {
  let title: string | null = null;
  let rest: Buffer = Buffer.alloc(0);
  for await (const chunk of createReadStream(path)) {
    const data: Buffer = rest.length > 0 ? Buffer.concat([rest, chunk as Buffer]) : (chunk as Buffer);
    let start = 0;
    for (let end = data.indexOf(LINE_BREAK); end !== -1; end = data.indexOf(LINE_BREAK, start)) {
      const line = data.subarray(start, end);
      start = end + 1;
      if (line.includes(MARKER)) title = titleOf(line) ?? title;
    }
    rest = data.subarray(start);
  }
  return title;
}

/** A session whose transcript was purged, or that has no title yet, is simply left out. */
export async function readSessionTitles(db: Db, sessionIds: string[]): Promise<Record<string, string>> {
  const wanted = new Set(sessionIds);
  const titles: Record<string, string> = {};
  const transcripts = db.select({ path: claudeTranscripts.path }).from(claudeTranscripts).all();

  for (const { path } of transcripts) {
    // Those of subagents are named after the agent, so they do not match.
    const sessionId = basename(path, ".jsonl");
    if (!wanted.has(sessionId)) continue;
    try {
      const { size } = await stat(path);
      let cached = known().get(path);
      if (cached?.size !== size) {
        cached = { size, title: await readTitle(path) };
        known().set(path, cached);
      }
      if (cached.title) titles[sessionId] = cached.title;
    } catch {
      // Purged since it was read.
    }
  }
  return titles;
}
