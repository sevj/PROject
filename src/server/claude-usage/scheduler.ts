import { getDb } from "../db/client";
import { syncClaudeUsage } from "./sync";

const INTERVAL_MS = 60_000;

// Kept on globalThis so that a hot reload in dev does not start a second loop.
const holder = globalThis as unknown as { __pmClaudeUsageSync?: boolean; __pmClaudeUsageQueue?: Promise<void> };

async function pass(): Promise<void> {
  try {
    const { unreadableLines } = await syncClaudeUsage(getDb());
    if (unreadableLines > 0) {
      console.warn(`Claude usage: ${unreadableLines} transcript lines could not be understood.`);
    }
  } catch (error) {
    console.warn("Claude usage: the transcripts could not be read.", error);
  }
}

/** One after the other: each pass starts from where the last one left the offsets. */
export function syncClaudeUsageNow(): Promise<void> {
  holder.__pmClaudeUsageQueue = (holder.__pmClaudeUsageQueue ?? Promise.resolve()).then(pass);
  return holder.__pmClaudeUsageQueue;
}

async function loop(): Promise<void> {
  await syncClaudeUsageNow();
  setTimeout(() => void loop(), INTERVAL_MS).unref();
}

/** Runs in the background: the server must not wait for a first read of the whole history. */
export function startClaudeUsageSync(): void {
  if (holder.__pmClaudeUsageSync) return;
  holder.__pmClaudeUsageSync = true;
  setTimeout(() => void loop(), 0).unref();
}
