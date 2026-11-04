"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { defaultRoot, runScan, type ScanResult } from "@/server/scan/run";

// A double click or a second tab must join the running scan, not start another one.
const holder = globalThis as unknown as { __pmScan?: Promise<ScanResult> };

export async function scanNow(): Promise<{ error: string | null }> {
  holder.__pmScan ??= runScan(getDb(), defaultRoot()).finally(() => {
    holder.__pmScan = undefined;
  });
  try {
    await holder.__pmScan;
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    revalidatePath("/");
  }
}
