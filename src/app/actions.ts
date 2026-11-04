"use server";

import { revalidatePath } from "next/cache";
import {
  addTag,
  deleteTag,
  importClassification,
  type ImportResult,
  isStatus,
  removeTag,
  renameTag,
  setAbandoned,
  setDescription,
  setDisplayName,
  setFavorite,
  setNote,
  setStatus,
} from "@/server/classification";
import { getDb } from "@/server/db/client";
import { serverMessages } from "@/server/i18n";
import type { ProjectStatus } from "@/server/db/schema";
import { isLocale } from "@/i18n";
import { ideCommandFor } from "@/lib/commands";
import { composeDirectories, launch, runCompose } from "@/server/project-actions";
import { type EnvEntry, readEnvFile } from "@/server/project-files";
import { getProject } from "@/server/registry";
import {
  changeDirectory,
  type ProjectInput,
  type Registered,
  registerMultiProject,
  registerProject,
  registerSubProject,
  removeProjects,
  type SubProjectInput,
} from "@/server/projects";
import { startRefresh, startSizing } from "@/server/scan/jobs";
import { refreshProjects, rescanProject } from "@/server/scan/run";
import { getSettings, saveSettings } from "@/server/settings";

export async function refreshEverything(): Promise<{ error: string | null }> {
  try {
    await startRefresh();
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    revalidatePath("/");
  }
}

/** Reads the folders that were just registered, so that they appear with their facts. */
async function readRegistered(result: Registered): Promise<Registered> {
  if ("ids" in result) {
    await refreshProjects(getDb(), result.ids);
    startSizing(result.ids);
  }
  revalidatePath("/", "layout");
  return result;
}

export async function addProject(input: ProjectInput): Promise<Registered> {
  return readRegistered(registerProject(getDb(), input));
}

export async function addMultiProject(input: ProjectInput, subProjects: SubProjectInput[]): Promise<Registered> {
  return readRegistered(registerMultiProject(getDb(), input, subProjects));
}

export async function addSubProject(groupId: number, input: SubProjectInput): Promise<Registered> {
  return readRegistered(registerSubProject(getDb(), groupId, input));
}

export async function moveProject(projectId: number, directory: string): Promise<string | null> {
  const result = await readRegistered(changeDirectory(getDb(), projectId, directory));
  return "error" in result ? result.error : null;
}

export async function removeFromList(projectIds: number[]): Promise<void> {
  removeProjects(getDb(), ids(projectIds));
  revalidatePath("/", "layout");
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

export async function renameProject(projectId: number, name: string): Promise<void> {
  setDisplayName(getDb(), projectId, String(name));
  refreshAll();
}

export async function saveDescription(projectId: number, description: string): Promise<void> {
  setDescription(getDb(), projectId, String(description));
  refreshAll();
}

export async function addTagTo(projectIds: number[], name: string): Promise<void> {
  addTag(getDb(), ids(projectIds), name);
  refreshAll();
}

export async function removeTagFrom(projectIds: number[], name: string): Promise<void> {
  removeTag(getDb(), ids(projectIds), String(name));
  refreshAll();
}

export async function renameTagByName(name: string, nextName: string): Promise<string | null> {
  const error = renameTag(getDb(), String(name), nextName);
  refreshAll();
  return error;
}

export async function deleteTagByName(name: string): Promise<void> {
  deleteTag(getDb(), String(name));
  refreshAll();
}

/** Restoring picks the project back up, since its data stopped being updated. */
export async function markAbandoned(projectIds: number[], abandoned: boolean): Promise<string | null> {
  const db = getDb();
  const projects = ids(projectIds);
  setAbandoned(db, projects, abandoned === true);
  if (abandoned !== true) {
    for (const projectId of projects) await rescanProject(db, projectId);
    startSizing(projects);
  }
  refreshAll();
  return null;
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
  const m = serverMessages(getDb()).errors;
  const project = launchable(projectId);
  if (!project) return m.projectGone;
  const { ideCommands } = getSettings(getDb());
  return launch(ideCommandFor(project.row.stacks, ideCommands), project.absolutePath, m);
}

export async function openTerminal(projectId: number): Promise<string | null> {
  const m = serverMessages(getDb()).errors;
  const project = launchable(projectId);
  if (!project) return m.projectGone;
  return launch(getSettings(getDb()).terminalCommand, project.absolutePath, m);
}

export async function dockerAction(projectId: number, mode: "up" | "stop"): Promise<string | null> {
  const m = serverMessages(getDb()).errors;
  const project = launchable(projectId);
  if (!project) return m.projectGone;
  if (mode !== "up" && mode !== "stop") return m.unknownAction;
  if (project.row.abandoned) return m.abandonedProject;
  const { hasCompose, containers } = project.compose;
  const error = await runCompose(mode, composeDirectories(mode, project.absolutePath, hasCompose, containers), m);
  // Docker has no live view: without this, the button would show a stale state.
  await rescanProject(getDb(), projectId);
  refreshAll();
  return error;
}

export async function saveSettingsForm(form: Record<string, string>): Promise<string | null> {
  const clean = (value: unknown) => String(value ?? "").trim();
  const ideCommands: Record<string, string> = {};
  for (const [key, value] of Object.entries(form)) {
    if (key.startsWith("ide:") && clean(value)) ideCommands[key.slice(4)] = clean(value);
  }
  if (!clean(form.terminal) || !ideCommands.default) return serverMessages(getDb()).errors.commandsRequired;
  saveSettings(getDb(), {
    terminalCommand: clean(form.terminal),
    ideCommands,
    ...(isLocale(form.locale) ? { locale: form.locale } : {}),
  });
  refreshAll();
  return null;
}
