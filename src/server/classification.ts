import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./db/client";
import {
  collections,
  PROJECT_STATUSES,
  type ProjectStatus,
  projectCollections,
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

type MetaPatch = Partial<Pick<typeof projectMeta.$inferInsert, "status" | "favorite" | "note">>;

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

export function createCollection(db: Db, name: string) {
  const clean = cleanName(name);
  if (!clean) return null;
  const position = db.select({ total: sql<number>`count(*)` }).from(collections).get()?.total ?? 0;
  return db
    .insert(collections)
    .values({ name: clean, position })
    .onConflictDoUpdate({ target: collections.name, set: { name: clean } })
    .returning()
    .get();
}

export function setCollectionMembership(db: Db, projectIds: number[], collectionId: number, member: boolean) {
  db.transaction((tx) => {
    if (!member) {
      tx.delete(projectCollections)
        .where(
          and(
            eq(projectCollections.collectionId, collectionId),
            inArray(projectCollections.projectId, projectIds),
          ),
        )
        .run();
      return;
    }
    for (const projectId of projectIds) {
      tx.insert(projectCollections).values({ projectId, collectionId }).onConflictDoNothing().run();
    }
  });
}

function ensureTag(db: Db, name: string) {
  return db
    .insert(tags)
    .values({ name })
    .onConflictDoUpdate({ target: tags.name, set: { name } })
    .returning()
    .get();
}

export function addTag(db: Db, projectIds: number[], name: string) {
  const clean = cleanName(name);
  if (!clean) return;
  db.transaction((tx) => {
    const tag = ensureTag(tx as unknown as Db, clean);
    for (const projectId of projectIds) {
      tx.insert(projectTags).values({ projectId, tagId: tag.id }).onConflictDoNothing().run();
    }
  });
}

/** A tag used by nobody disappears from the suggestions. */
export function removeTag(db: Db, projectId: number, name: string) {
  db.transaction((tx) => {
    const tag = tx.select().from(tags).where(eq(tags.name, name)).get();
    if (!tag) return;
    tx.delete(projectTags)
      .where(and(eq(projectTags.projectId, projectId), eq(projectTags.tagId, tag.id)))
      .run();
    const left = tx.select().from(projectTags).where(eq(projectTags.tagId, tag.id)).limit(1).get();
    if (!left) tx.delete(tags).where(eq(tags.id, tag.id)).run();
  });
}

export type ClassificationExport = {
  version: 1;
  collections: string[];
  projects: {
    path: string;
    status: ProjectStatus | null;
    favorite: boolean;
    note: string | null;
    collections: string[];
    tags: string[];
  }[];
};

export function exportClassification(db: Db): ClassificationExport {
  const collectionRows = db.select().from(collections).orderBy(collections.position).all();
  const collectionNames = new Map(collectionRows.map(({ id, name }) => [id, name]));
  const tagNames = new Map(db.select().from(tags).all().map(({ id, name }) => [id, name]));
  const metas = new Map(db.select().from(projectMeta).all().map((meta) => [meta.projectId, meta]));
  const memberships = db.select().from(projectCollections).all();
  const taggings = db.select().from(projectTags).all();

  const exported: ClassificationExport["projects"] = [];
  for (const project of db.select().from(projects).all()) {
    const meta = metas.get(project.id);
    const inCollections = memberships
      .filter((item) => item.projectId === project.id)
      .flatMap((item) => collectionNames.get(item.collectionId) ?? []);
    const withTags = taggings
      .filter((item) => item.projectId === project.id)
      .flatMap((item) => tagNames.get(item.tagId) ?? []);
    // Only what the user decided: everything else is recalculated by a scan.
    if (!meta && inCollections.length === 0 && withTags.length === 0) continue;
    exported.push({
      path: project.path,
      status: meta?.status ?? null,
      favorite: meta?.favorite ?? false,
      note: meta?.note ?? null,
      collections: inCollections,
      tags: withTags,
    });
  }
  return { version: 1, collections: collectionRows.map(({ name }) => name), projects: exported };
}

function parseExport(input: unknown): ClassificationExport | null {
  const data = input as Partial<ClassificationExport> | null;
  if (data?.version !== 1 || !Array.isArray(data.collections) || !Array.isArray(data.projects)) return null;
  const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");
  if (!strings(data.collections)) return null;
  const valid = data.projects.every(
    (project) =>
      typeof project?.path === "string" &&
      (project.status === null || isStatus(project.status)) &&
      typeof project.favorite === "boolean" &&
      (project.note === null || typeof project.note === "string") &&
      strings(project.collections) &&
      strings(project.tags),
  );
  return valid ? (data as ClassificationExport) : null;
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
  const data = parseExport(parsed);
  if (!data) return { error: "Ce fichier n'est pas un export de Project Manager." };

  return db.transaction((tx) => {
    const txDb = tx as unknown as Db;
    for (const name of data.collections) createCollection(txDb, name);
    const collectionIds = new Map(tx.select().from(collections).all().map(({ id, name }) => [name, id]));
    const projectIds = new Map(tx.select().from(projects).all().map(({ id, path }) => [path, id]));

    const unknownPaths: string[] = [];
    let imported = 0;
    for (const item of data.projects) {
      const projectId = projectIds.get(item.path);
      if (projectId === undefined) {
        unknownPaths.push(item.path);
        continue;
      }
      patchMeta(txDb, [projectId], {
        status: item.status,
        favorite: item.favorite,
        note: item.note,
      });
      tx.delete(projectCollections).where(eq(projectCollections.projectId, projectId)).run();
      tx.delete(projectTags).where(eq(projectTags.projectId, projectId)).run();
      for (const name of item.collections) {
        const collection = createCollection(txDb, name);
        if (collection) {
          collectionIds.set(collection.name, collection.id);
          setCollectionMembership(txDb, [projectId], collection.id, true);
        }
      }
      for (const name of item.tags) addTag(txDb, [projectId], name);
      imported += 1;
    }
    return { imported, unknownPaths };
  });
}
