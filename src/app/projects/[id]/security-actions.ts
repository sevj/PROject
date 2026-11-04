"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { analyzeDependencies } from "@/server/dependencies";
import { serverMessages } from "@/server/i18n";
import { getProject } from "@/server/registry";

/** Returns an error message, or nothing when the analysis was done and kept. */
export async function analyzeProject(projectId: number): Promise<string | undefined> {
  const db = getDb();
  const m = serverMessages(db).dependencies;
  const project = Number.isInteger(projectId) ? getProject(db, projectId) : null;
  if (!project || project.row.missing || project.row.abandoned) return m.unavailable;
  try {
    const outcome = await analyzeDependencies(db, projectId, project.absolutePath);
    if ("error" in outcome) return outcome.error === "busy" ? m.busy : m.unavailable;
  } catch (error) {
    return m.failed(error instanceof Error ? error.message : String(error));
  }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
}
