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

const MAX_NAME = 80;
const MAX_NOTE = 20_000;

export function cleanName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const clean = name.trim().replace(/\s+/g, " ");
  return clean.length > 0 && clean.length <= MAX_NAME ? clean : null;
}

export function isStatus(value: unknown): value is ProjectStatus {
  return PROJECT_STATUSES.includes(value as ProjectStatus);
}

type MetaPatch = Partial<Pick<typeof projectMeta.$inferInsert, "status" | "favorite" | "note" | "displayName">>;

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

export function setAbandoned(db: Db, projectIds: number[], abandoned: boolean) {
  if (projectIds.length === 0) return;
  db.transaction((tx) => {
    tx.update(projects).set({ abandoned }).where(inArray(projects.id, projectIds)).run();
    if (abandoned) {
      // No scan will update these again, so a running state would stay wrong forever.
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
  const clean = cleanName(nextName);
  if (!clean) return "Ce nom de tag n'est pas valide.";
  const tag = db.select().from(tags).where(eq(tags.name, name)).get();
  if (!tag) return "Ce tag n'existe plus.";
  const lower = clean.toLocaleLowerCase("fr");
  const taken = db.select().from(tags).all().find((item) => item.name.toLocaleLowerCase("fr") === lower);
  if (taken && taken.id !== tag.id) return `Le tag « ${taken.name} » existe déjà.`;
  db.update(tags).set({ name: clean }).where(eq(tags.id, tag.id)).run();
  return null;
}

/** Only removes the label: its projects and the rest of their classification stay. */
export function deleteTag(db: Db, name: string) {
  db.delete(tags).where(eq(tags.name, name)).run();
}

export type ExportedProject = {
  path: string;
  status: ProjectStatus | null;
  favorite: boolean;
  note: string | null;
  displayName: string | null;
  abandoned: boolean;
  tags: string[];
};

export type ClassificationExport = { version: 2; projects: ExportedProject[] };

export function exportClassification(db: Db): ClassificationExport {
  const tagNames = new Map(db.select().from(tags).all().map(({ id, name }) => [id, name]));
  const metas = new Map(db.select().from(projectMeta).all().map((meta) => [meta.projectId, meta]));
  const taggings = db.select().from(projectTags).all();

  const exported: ExportedProject[] = [];
  for (const project of db.select().from(projects).all()) {
    const meta = metas.get(project.id);
    const withTags = taggings
      .filter((item) => item.projectId === project.id)
      .flatMap((item) => tagNames.get(item.tagId) ?? [])
      .sort((a, b) => a.localeCompare(b, "fr"));
    // Only what the user decided: everything else is recalculated by a scan.
    if (!meta && !project.abandoned && withTags.length === 0) continue;
    exported.push({
      path: project.path,
      status: meta?.status ?? null,
      favorite: meta?.favorite ?? false,
      note: meta?.note ?? null,
      displayName: meta?.displayName ?? null,
      abandoned: project.abandoned,
      tags: withTags,
    });
  }
  return { version: 2, projects: exported };
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function parseProject(input: unknown, version: number): ExportedProject | null {
  const raw = input as Record<string, unknown> | null;
  // "archived" no longer exists: an older export must stay importable.
  const item = raw?.status === "archived" ? { ...raw, status: null } : raw;
  if (
    typeof item?.path !== "string" ||
    !(item.status === null || isStatus(item.status)) ||
    typeof item.favorite !== "boolean" ||
    !(item.note === null || typeof item.note === "string") ||
    !isStrings(item.tags)
  ) {
    return null;
  }
  // Absent from exports made before project names existed.
  const displayName = item.displayName ?? null;
  if (displayName !== null && typeof displayName !== "string") return null;
  const base = { path: item.path, status: item.status, favorite: item.favorite, note: item.note, displayName };
  if (version === 2) {
    return typeof item.abandoned === "boolean" ? { ...base, abandoned: item.abandoned, tags: item.tags } : null;
  }
  // Exports made while collections existed: the same conversion as the database migration.
  if (!isStrings(item.collections)) return null;
  return {
    ...base,
    abandoned: item.collections.includes("Abandonnés"),
    tags: [...item.tags, ...item.collections.filter((name) => name !== "Abandonnés")],
  };
}

function parseExport(input: unknown): ExportedProject[] | null {
  const data = input as { version?: unknown; projects?: unknown } | null;
  if ((data?.version !== 1 && data?.version !== 2) || !Array.isArray(data.projects)) return null;
  const parsed = data.projects.map((project) => parseProject(project, data.version as number));
  return parsed.every((project) => project !== null) ? (parsed as ExportedProject[]) : null;
}

export type ImportResult = { imported: number; unknownPaths: string[] } | { error: string };

/** Replaces the classification of listed projects and leaves the others alone. */
export function importClassification(db: Db, json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { error: "Ce fichier n'est pas du JSON valide." };
  }
  const items = parseExport(parsed);
  if (!items) return { error: "Ce fichier n'est pas un export de Project Manager." };

  return db.transaction((tx) => {
    const txDb = tx as unknown as Db;
    const projectIds = new Map(tx.select().from(projects).all().map(({ id, path }) => [path, id]));

    const unknownPaths: string[] = [];
    let imported = 0;
    for (const item of items) {
      const projectId = projectIds.get(item.path);
      if (projectId === undefined) {
        unknownPaths.push(item.path);
        continue;
      }
      patchMeta(txDb, [projectId], {
        status: item.status,
        favorite: item.favorite,
        note: item.note,
        displayName: item.displayName,
      });
      setAbandoned(txDb, [projectId], item.abandoned);
      tx.delete(projectTags).where(eq(projectTags.projectId, projectId)).run();
      for (const name of item.tags) addTag(txDb, [projectId], name);
      imported += 1;
    }
    return { imported, unknownPaths };
  });
}
