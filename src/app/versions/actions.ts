"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { readVersionsReport } from "@/server/versions";

/** Reads endoflife.date again, whatever the age of the copy kept. */
export async function reloadSupportDates(): Promise<void> {
  await readVersionsReport(getDb(), { force: true });
  revalidatePath("/versions");
}
