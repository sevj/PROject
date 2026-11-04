import { desc, eq } from "drizzle-orm";
import { homedir } from "node:os";
import type { RegistryRow } from "@/lib/registry";
import type { Db } from "./db/client";
import {
  collections,
  projectCollections,
  projectFacts,
  projectMeta,
  projects,
  projectTags,
  scans,
  tags,
} from "./db/schema";

function displayPath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

type Joined = { project: typeof projects.$inferSelect; facts: typeof projectFacts.$inferSelect };

type Classification = {
  meta: typeof projectMeta.$inferSelect | undefined;
  collectionIds: number[];
  tags: string[];
};

function loadClassification(db: Db, projectId?: number): (id: number) => Classification {
  const metas = new Map(
    db
      .select()
      .from(projectMeta)
      .where(projectId === undefined ? undefined : eq(projectMeta.projectId, projectId))
      .all()
      .map((meta) => [meta.projectId, meta]),
  );
  const collectionIds = new Map<number, number[]>();
  for (const { projectId: id, collectionId } of db.select().from(projectCollections).all()) {
    collectionIds.set(id, [...(collectionIds.get(id) ?? []), collectionId]);
  }
  const tagNames = new Map(db.select().from(tags).all().map(({ id, name }) => [id, name]));
  const projectTagNames = new Map<number, string[]>();
  for (const { projectId: id, tagId } of db.select().from(projectTags).all()) {
    const name = tagNames.get(tagId);
    if (name) projectTagNames.set(id, [...(projectTagNames.get(id) ?? []), name]);
  }
  return (id) => ({
    meta: metas.get(id),
    collectionIds: collectionIds.get(id) ?? [],
    tags: (projectTagNames.get(id) ?? []).sort((a, b) => a.localeCompare(b, "fr")),
  });
}

function loadLists(db: Db) {
  return {
    collections: db
      .select({ id: collections.id, name: collections.name })
      .from(collections)
      .orderBy(collections.position, collections.id)
      .all(),
    knownTags: db
      .select({ name: tags.name })
      .from(tags)
      .all()
      .map(({ name }) => name)
      .sort((a, b) => a.localeCompare(b, "fr")),
  };
}

function toRow(
  { project, facts }: Joined,
  parentName: string | null,
  { meta, collectionIds, tags: rowTags }: Classification,
): RegistryRow {
  return {
    id: project.id,
    name: project.name,
    path: displayPath(project.path),
    parentName,
    kind: project.kind === "folder" ? "folder" : "project",
    missing: project.missingAt !== null,
    stacks: facts.stacks,
    hasGit: facts.hasGit,
    branch: facts.branch,
    upstream: facts.upstream,
    ahead: facts.ahead,
    behind: facts.behind,
    dirtyCount: facts.dirtyCount,
    remoteUrl: facts.remoteUrl,
    commitCount: facts.commitCount,
    lastCommitAt: facts.lastCommitAt?.getTime() ?? null,
    lastCommitSubject: facts.lastCommitSubject,
    weeklyCommits: facts.weeklyCommits,
    hasCompose: facts.hasCompose,
    containers: facts.containers,
    sizeBytes: facts.sizeBytes,
    scanError: facts.scanError,
    status: meta?.status ?? null,
    favorite: meta?.favorite ?? false,
    note: meta?.note ?? null,
    collectionIds,
    tags: rowTags,
  };
}

export function getProject(db: Db, id: number) {
  const joined = db
    .select({ project: projects, facts: projectFacts })
    .from(projects)
    .innerJoin(projectFacts, eq(projectFacts.projectId, projects.id))
    .where(eq(projects.id, id))
    .get();
  if (!joined) return null;
  const parent = joined.project.parentId
    ? db.select().from(projects).where(eq(projects.id, joined.project.parentId)).get()
    : undefined;
  return {
    row: toRow(joined, parent?.name ?? null, loadClassification(db, id)(id)),
    ...loadLists(db),
    absolutePath: joined.project.path,
    docs: joined.facts.docs,
    envFiles: joined.facts.envFiles,
    now: Date.now(),
  };
}

export function getRegistry(db: Db) {
  const all = db
    .select({ project: projects, facts: projectFacts })
    .from(projects)
    .innerJoin(projectFacts, eq(projectFacts.projectId, projects.id))
    .all();
  const names = new Map(all.map(({ project }) => [project.id, project.name]));

  const classificationOf = loadClassification(db);

  const rows: RegistryRow[] = [];
  for (const joined of all) {
    const { project } = joined;
    // A group is only a heading for its children, and hidden folders are the user's call.
    if (project.kind === "group" || project.hidden) continue;
    rows.push(toRow(joined, project.parentId ? (names.get(project.parentId) ?? null) : null, classificationOf(project.id)));
  }

  const lastScan = db.select().from(scans).orderBy(desc(scans.id)).limit(1).get();
  return {
    rows,
    ...loadLists(db),
    now: Date.now(),
    lastScan: lastScan
      ? {
          status: lastScan.status,
          at: (lastScan.finishedAt ?? lastScan.startedAt).getTime(),
          error: lastScan.error,
          warning: lastScan.warning,
        }
      : null,
  };
}
