"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { serverMessages } from "@/server/i18n";
import { cleanup, type CleanupKind, readDisk, removeVolume } from "@/server/resources";

const KINDS: readonly string[] = ["images", "containers", "cache"];

/** Docker's own words ("Total reclaimed space: 1.2GB"), kept as the user's reading of the result. */
export async function runCleanup(kind: string): Promise<{ reclaimed: string } | { error: string }> {
  if (!KINDS.includes(kind)) return { error: "unknown cleanup" };
  const result = await cleanup(kind as CleanupKind);
  if ("error" in result) return result;
  revalidatePath("/resources");
  return { reclaimed: /reclaimed space:\s*(.+)/i.exec(result.output)?.[1]?.trim() ?? "" };
}

/**
 * One volume at a time. The name is typed again by the user, and the volume must still be
 * listed by Docker: nothing is removed on the strength of a stale page.
 */
export async function deleteVolume(name: string, confirmName: string): Promise<{ ok: true } | { error: string }> {
  const m = serverMessages(getDb()).resources.volumes;
  if (typeof name !== "string" || name === "" || name !== confirmName) return { error: m.failed("name mismatch") };
  const report = await readDisk(getDb());
  if (!report.volumes.some((volume) => volume.name === name)) return { error: m.failed("not found") };
  const result = await removeVolume(name);
  if ("error" in result) return { error: m.failed(result.error) };
  revalidatePath("/resources");
  return result;
}
