"use server";

import { revalidatePath } from "next/cache";
import {
  addTag,
  createCollection,
  importClassification,
  type ImportResult,
  isStatus,
  removeTag,
  setCollectionMembership,
  setFavorite,
  setNote,
  setStatus,
} from "@/server/classification";
import { getDb } from "@/server/db/client";
import type { ProjectStatus } from "@/server/db/schema";
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

function refreshAll() {
  revalidatePath("/", "layout");
}

function ids(values: number[]): number[] {
  return values.filter(Number.isInteger);
}

export async function updateStatus(projectIds: number[], status: ProjectStatus | null): Promise<void> {
  if (status !== null && !isStatus(status)) return;
  setStatus(getDb(), ids(projectIds), status);
  refreshAll();
}

export async function toggleFavorite(projectId: number, favorite: boolean): Promise<void> {
  setFavorite(getDb(), projectId, favorite === true);
  refreshAll();
}

export async function saveNote(projectId: number, note: string): Promise<void> {
  setNote(getDb(), projectId, String(note));
  refreshAll();
}

export async function addCollection(name: string): Promise<void> {
  createCollection(getDb(), name);
  refreshAll();
}

export async function toggleCollection(projectIds: number[], collectionId: number, member: boolean): Promise<void> {
  setCollectionMembership(getDb(), ids(projectIds), collectionId, member === true);
  refreshAll();
}

export async function addTagTo(projectIds: number[], name: string): Promise<void> {
  addTag(getDb(), ids(projectIds), name);
  refreshAll();
}

export async function removeTagFrom(projectId: number, name: string): Promise<void> {
  removeTag(getDb(), projectId, String(name));
  refreshAll();
}

export async function importBackup(json: string): Promise<ImportResult> {
  const result = importClassification(getDb(), String(json));
  refreshAll();
  return result;
}
