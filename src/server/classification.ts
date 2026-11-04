import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  PROJECT_STATUSES,
  type ProjectStatus,
  projectFacts,
  projectMeta,
  projects,
  projectTags,
  tags,
} from "./db/schema";
import { serverMessages } from "./i18n";

const MAX_NAME = 80;
const MAX_NOTE = 20_000;
const MAX_DESCRIPTION = 500;

export function cleanName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const clean = name.trim().replace(/\s+/g, " ");
  return clean.length > 0 && clean.length <= MAX_NAME ? clean : null;
}

export function isStatus(value: unknown): value is ProjectStatus {
  return PROJECT_STATUSES.includes(value as ProjectStatus);
}

type MetaPatch = Partial<Pick<typeof projectMeta.$inferInsert, "status" | "favorite" | "note" | "displayName" | "description">>;

function patchMeta(db: Db, projectIds: number[], patch: MetaPatch) {
  db.transaction((tx) => {
    for (const projectId of projectIds) {
      tx.insert(projectMeta)
        .values({ projectId, ...patch })
        .onConflictDoUpdate({
          target: projectMeta.projectId,
          set: { ...patch, updatedAt: sql`(unixepoch())` },
        })
        .run();
    }
  });
}

export function setStatus(db: Db, projectIds: number[], status: ProjectStatus | null) {
  patchMeta(db, projectIds, { status });
}

export function setFavorite(db: Db, projectId: number, favorite: boolean) {
  patchMeta(db, [projectId], { favorite });
}

export function setNote(db: Db, projectId: number, note: string) {
  patchMeta(db, [projectId], { note: note.slice(0, MAX_NOTE) || null });
}

/** An empty name, or the folder's own name, goes back to following the folder. */
export function setDisplayName(db: Db, projectId: number, name: string) {
  const project = db.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return;
  const clean = cleanName(name);
  patchMeta(db, [projectId], { displayName: clean && clean !== project.name ? clean : null });
}

export function setDescription(db: Db, projectId: number, description: string) {
  patchMeta(db, [projectId], { description: description.trim().slice(0, MAX_DESCRIPTION) || null });
}

export function setAbandoned(db: Db, projectIds: number[], abandoned: boolean) {
  if (projectIds.length === 0) return;
  db.transaction((tx) => {
    tx.update(projects).set({ abandoned }).where(inArray(projects.id, projectIds)).run();
    if (abandoned) {
      // No refresh will update these again, so a running state would stay wrong forever.
      tx.update(projectFacts).set({ containers: [] }).where(inArray(projectFacts.projectId, projectIds)).run();
    }
  });
}

/** `Adimeo` and `adimeo` are one tag: the first spelling is kept. */
function ensureTag(db: Db, name: string) {
  const lower = name.toLocaleLowerCase("fr");
  const existing = db.select().from(tags).all().find((tag) => tag.name.toLocaleLowerCase("fr") === lower);
  return existing ?? db.insert(tags).values({ name }).returning().get();
}

export function addTag(db: Db, projectIds: number[], name: string) {
  const clean = cleanName(name);
  if (!clean || projectIds.length === 0) return;
  db.transaction((tx) => {
    const tag = ensureTag(tx as unknown as Db, clean);
    for (const projectId of projectIds) {
      tx.insert(projectTags).values({ projectId, tagId: tag.id }).onConflictDoNothing().run();
    }
  });
}

/** An unused tag stays available: it only goes away when deleted from the settings. */
export function removeTag(db: Db, projectIds: number[], name: string) {
  if (projectIds.length === 0) return;
  db.transaction((tx) => {
    const tag = tx.select().from(tags).where(eq(tags.name, name)).get();
    if (!tag) return;
    tx.delete(projectTags)
      .where(and(inArray(projectTags.projectId, projectIds), eq(projectTags.tagId, tag.id)))
      .run();
  });
}

export function renameTag(db: Db, name: string, nextName: string): string | null {
  const m = serverMessages(db).errors;
  const clean = cleanName(nextName);
  if (!clean) return m.tagInvalid;
  const tag = db.select().from(tags).where(eq(tags.name, name)).get();
  if (!tag) return m.tagGone;
  const lower = clean.toLocaleLowerCase("fr");
  const taken = db.select().from(tags).all().find((item) => item.name.toLocaleLowerCase("fr") === lower);
  if (taken && taken.id !== tag.id) return m.tagExists(taken.name);
  db.update(tags).set({ name: clean }).where(eq(tags.id, tag.id)).run();
  return null;
}

/** Only removes the label: its projects and the rest of their classification stay. */
export function deleteTag(db: Db, name: string) {
  db.delete(tags).where(eq(tags.name, name)).run();
}
