"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { type EnvEntry, readEnvFile } from "@/server/project-files";
import { getProject } from "@/server/registry";
import { startScan, startSizing } from "@/server/scan/jobs";
import { rescanProject } from "@/server/scan/run";

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

export async function refreshProject(projectId: number): Promise<void> {
  const exists = await rescanProject(getDb(), projectId);
  if (exists) startSizing([projectId]);
  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
}

export async function revealEnvFile(projectId: number, fileName: string): Promise<EnvEntry[] | null> {
  const project = getProject(getDb(), projectId);
  return project ? readEnvFile(project.absolutePath, fileName) : null;
}
