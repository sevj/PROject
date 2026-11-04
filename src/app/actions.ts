"use server";

import { revalidatePath } from "next/cache";
import { startScan } from "@/server/scan/jobs";

export async function scanNow(): Promise<{ error: string | null }> {
  try {
    await startScan();
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    revalidatePath("/");
  }
}
