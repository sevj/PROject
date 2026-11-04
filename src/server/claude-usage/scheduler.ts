import { getDb } from "../db/client";
import { syncClaudeUsage } from "./sync";

const INTERVAL_MS = 60_000;

// Kept on globalThis so that a hot reload in dev does not start a second loop.
const holder = globalThis as unknown as { __pmClaudeUsageSync?: boolean };

async function pass(): Promise<void> {
  try {
    const { unreadableLines } = await syncClaudeUsage(getDb());
    if (unreadableLines > 0) {
      console.warn(`Claude usage: ${unreadableLines} transcript lines could not be understood.`);
    }
  } catch (error) {
    console.warn("Claude usage: the transcripts could not be read.", error);
  }
  // Timed from the end of a pass: the first one can be long, and two must never overlap.
  setTimeout(() => void pass(), INTERVAL_MS).unref();
}

/** Runs in the background: the server must not wait for a first read of the whole history. */
export function startClaudeUsageSync(): void {
  if (holder.__pmClaudeUsageSync) return;
  holder.__pmClaudeUsageSync = true;
  setTimeout(() => void pass(), 0).unref();
}
