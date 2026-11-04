import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSessionId } from "@/lib/claude-console";

/**
 * A console follows one conversation, whose id changes on `/clear`. Claude says so through
 * a SessionStart hook given to that console alone, which leaves a line in a private file.
 */
export type TrackedConsole = {
  /** Every session of this console since it first opened, oldest first. */
  sessionIds: string[];
  running: boolean;
  /** Where the hook writes. Null once the program has ended. */
  file: string | null;
};

// Kept on globalThis so that a hot reload in dev does not lose track of what is running.
const holder = globalThis as unknown as { __pmClaudeConsoles?: Set<TrackedConsole> };
const consoles = () => (holder.__pmClaudeConsoles ??= new Set());

function refresh(tracked: TrackedConsole): void {
  if (!tracked.file) return;
  let content: string;
  try {
    content = readFileSync(tracked.file, "utf8");
  } catch {
    // Nothing written yet, or hooks are turned off: then the first id is all there is to know.
    return;
  }
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const { session_id: id } = JSON.parse(line) as { session_id?: unknown };
      if (isSessionId(id) && tracked.sessionIds.at(-1) !== id) {
        tracked.sessionIds = [...tracked.sessionIds.filter((known) => known !== id), id];
      }
    } catch {
      // A line being written: the next read gets it whole.
    }
  }
}

const find = (sessionId: string): TrackedConsole | null => {
  for (const tracked of consoles()) {
    refresh(tracked);
    if (tracked.sessionIds.includes(sessionId)) return tracked;
  }
  return null;
};

/** Whether a program is on this conversation right now, in this browser tab or another. */
export function isSessionOpen(sessionId: string): boolean {
  for (const tracked of consoles()) {
    refresh(tracked);
    if (tracked.running && tracked.sessionIds.at(-1) === sessionId) return true;
  }
  return false;
}

/** A console that resumes its own conversation carries on with what it already knew. */
export function trackConsole(sessionId: string): TrackedConsole & { file: string } {
  const file = join(mkdtempSync(join(tmpdir(), "pm-claude-console-")), "sessions.jsonl");
  const known = find(sessionId);
  const tracked = known ?? { sessionIds: [sessionId], running: true, file };
  tracked.file = file;
  tracked.running = true;
  consoles().add(tracked);
  return tracked as TrackedConsole & { file: string };
}

export function endConsole(tracked: TrackedConsole): void {
  refresh(tracked);
  tracked.running = false;
  if (tracked.file) rmSync(join(tracked.file, ".."), { recursive: true, force: true });
  tracked.file = null;
}

/** From any id it has had: the sessions of that console, with the current one last. */
export function sessionsOfConsole(sessionId: string): string[] {
  return find(sessionId)?.sessionIds ?? [sessionId];
}
