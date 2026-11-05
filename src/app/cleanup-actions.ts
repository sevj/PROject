"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { serverMessages } from "@/server/i18n";
import { type Cleanable, type CleanupResult, readCleanable, removeCleanable } from "@/server/project-cleanup";
import { getProject, getRegistry } from "@/server/registry";
import { mapLimit } from "@/server/scan/limit";
import { runningCount } from "@/lib/registry";
import { startSizing } from "@/server/scan/jobs";

export type ProjectCleanable = { projectId: number; name: string; running: number; items: Cleanable[] };

const PROJECTS_AT_ONCE = 3;

/** On demand: weighing every project takes a while, and the page does not need it to open. */
export async function loadCleanable(projectId?: number): Promise<ProjectCleanable[]> {
  const rows = getRegistry(getDb()).rows.filter(
    ({ id, missing, abandoned, hasGit }) => !missing && !abandoned && hasGit && (projectId === undefined || id === projectId),
  );
  const found = await mapLimit(rows, PROJECTS_AT_ONCE, async (row): Promise<ProjectCleanable> => {
    const project = getProject(getDb(), row.id);
    return { projectId: row.id, name: row.name, running: runningCount(row), items: project ? await readCleanable(project.absolutePath) : [] };
  });
  return found.filter(({ items }) => items.length > 0);
}

/** Deleting is what the browser has to say a person asked for. Only what is offered right now goes. */
export async function cleanProject(projectId: number, names: unknown, confirmed: boolean): Promise<CleanupResult | { error: string }> {
  const db = getDb();
  const m = serverMessages(db).errors;
  if (confirmed !== true || !Array.isArray(names)) return { error: m.loadNotConfirmed };
  const project = Number.isInteger(projectId) ? getProject(db, projectId) : null;
  if (!project || project.row.missing || project.row.abandoned) return { error: m.projectGone };
  const result = await removeCleanable(project.absolutePath, names.filter((name): name is string => typeof name === "string"));
  startSizing([projectId]);
  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
  return result;
}
