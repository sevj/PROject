"use server";

import { revalidatePath } from "next/cache";
import {
  addTag,
  createCollection,
  deleteCollection,
  importClassification,
  type ImportResult,
  isStatus,
  removeTag,
  renameCollection,
  setCollectionMembership,
  setFavorite,
  setHidden,
  setNote,
  setStatus,
} from "@/server/classification";
import { getDb } from "@/server/db/client";
import type { ProjectStatus } from "@/server/db/schema";
import { ideCommandFor } from "@/lib/commands";
import { composeDirectories, launch, runCompose } from "@/server/project-actions";
import { type EnvEntry, readEnvFile } from "@/server/project-files";
import { getProject } from "@/server/registry";
import { startScan, startSizing } from "@/server/scan/jobs";
import { rescanProject } from "@/server/scan/run";
import { getSettings, saveSettings } from "@/server/settings";

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

function launchable(projectId: number) {
  const project = getProject(getDb(), projectId);
  // The path comes from the database, never from the browser.
  return project && !project.row.missing ? project : null;
}

export async function openIde(projectId: number): Promise<string | null> {
  const project = launchable(projectId);
  if (!project) return "Ce projet n'existe plus.";
  const { ideCommands } = getSettings(getDb());
  return launch(ideCommandFor(project.row.stacks, ideCommands), project.absolutePath);
}

export async function openTerminal(projectId: number): Promise<string | null> {
  const project = launchable(projectId);
  if (!project) return "Ce projet n'existe plus.";
  return launch(getSettings(getDb()).terminalCommand, project.absolutePath);
}

export async function dockerAction(projectId: number, mode: "up" | "stop"): Promise<string | null> {
  const project = launchable(projectId);
  if (!project) return "Ce projet n'existe plus.";
  if (mode !== "up" && mode !== "stop") return "Action inconnue.";
  const { hasCompose, containers } = project.compose;
  const error = await runCompose(mode, composeDirectories(mode, project.absolutePath, hasCompose, containers));
  // Docker has no live view: without this, the button would show a stale state.
  await rescanProject(getDb(), projectId);
  refreshAll();
  return error;
}

export async function hideProject(projectId: number): Promise<string | null> {
  setHidden(getDb(), projectId, true);
  refreshAll();
  return null;
}

export async function showProject(projectId: number): Promise<void> {
  setHidden(getDb(), projectId, false);
  refreshAll();
}

export async function renameCollectionById(id: number, name: string): Promise<string | null> {
  const error = renameCollection(getDb(), id, name);
  refreshAll();
  return error;
}

export async function deleteCollectionById(id: number): Promise<void> {
  deleteCollection(getDb(), id);
  refreshAll();
}

export async function saveSettingsForm(form: Record<string, string>): Promise<string | null> {
  const clean = (value: unknown) => String(value ?? "").trim();
  const ideCommands: Record<string, string> = {};
  for (const [key, value] of Object.entries(form)) {
    if (key.startsWith("ide:") && clean(value)) ideCommands[key.slice(4)] = clean(value);
  }
  if (!clean(form.terminal) || !ideCommands.default) return "Toutes les commandes requises doivent être remplies.";
  const error = saveSettings(getDb(), {
    root: clean(form.root).replace(/\/+$/, "") || "/",
    terminalCommand: clean(form.terminal),
    ideCommands,
  });
  refreshAll();
  return error;
}
