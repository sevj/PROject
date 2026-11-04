import { desc, eq } from "drizzle-orm";
import { homedir } from "node:os";
import { ideCommandFor, ideLabel } from "@/lib/commands";
import type { RegistryRow } from "@/lib/registry";
import type { Db } from "./db/client";
import { projectFacts, projectMeta, projects, projectTags, scans, tags } from "./db/schema";
import { getSettings } from "./settings";

export function displayPath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

type Joined = { project: typeof projects.$inferSelect; facts: typeof projectFacts.$inferSelect };

type Classification = {
  meta: typeof projectMeta.$inferSelect | undefined;
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
  const tagNames = new Map(db.select().from(tags).all().map(({ id, name }) => [id, name]));
  const projectTagNames = new Map<number, string[]>();
  for (const { projectId: id, tagId } of db.select().from(projectTags).all()) {
    const name = tagNames.get(tagId);
    if (name) projectTagNames.set(id, [...(projectTagNames.get(id) ?? []), name]);
  }
  return (id) => ({
    meta: metas.get(id),
    tags: (projectTagNames.get(id) ?? []).sort((a, b) => a.localeCompare(b, "fr")),
  });
}

function loadKnownTags(db: Db): string[] {
  return db
    .select({ name: tags.name })
    .from(tags)
    .all()
    .map(({ name }) => name)
    .sort((a, b) => a.localeCompare(b, "fr"));
}

function toRow(
  { project, facts }: Joined,
  parent: { name: string; folderName: string; sizeBytes: number | null } | null,
  { meta, tags: rowTags }: Classification,
  ideCommands: Record<string, string>,
): RegistryRow {
  return {
    id: project.id,
    name: meta?.displayName ?? project.name,
    folderName: project.name,
    path: displayPath(project.path),
    parentId: project.parentId,
    parentName: parent?.name ?? null,
    parentFolderName: parent?.folderName ?? null,
    parentSizeBytes: parent?.sizeBytes ?? null,
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
    branchCount: facts.branchCount,
    stashCount: facts.stashCount,
    firstCommitAt: facts.firstCommitAt?.getTime() ?? null,
    lastCommitAuthor: facts.lastCommitAuthor,
    lastCommitAt: facts.lastCommitAt?.getTime() ?? null,
    lastCommitSubject: facts.lastCommitSubject,
    weeklyCommits: facts.weeklyCommits,
    hasCompose: facts.hasCompose,
    containers: facts.containers,
    sizeBytes: facts.sizeBytes,
    depsBytes: facts.depsBytes,
    gitBytes: facts.gitBytes,
    versions: facts.versions,
    packageManagers: facts.packageManagers,
    ci: facts.ci,
    testTools: facts.testTools,
    docs: facts.docs,
    envFiles: facts.envFiles,
    manifestDescription: facts.manifestDescription,
    description: meta?.description ?? null,
    scanError: facts.scanError,
    ideLabel: ideLabel(ideCommandFor(facts.stacks, ideCommands)),
    status: meta?.status ?? null,
    favorite: meta?.favorite ?? false,
    note: meta?.note ?? null,
    abandoned: project.abandoned,
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
  const parentRow = joined.project.parentId
    ? db
        .select({ name: projects.name, sizeBytes: projectFacts.sizeBytes, displayName: projectMeta.displayName })
        .from(projects)
        .innerJoin(projectFacts, eq(projectFacts.projectId, projects.id))
        .leftJoin(projectMeta, eq(projectMeta.projectId, projects.id))
        .where(eq(projects.id, joined.project.parentId))
        .get()
    : undefined;
  const parent = parentRow
    ? { name: parentRow.displayName ?? parentRow.name, folderName: parentRow.name, sizeBytes: parentRow.sizeBytes }
    : null;
  return {
    row: toRow(joined, parent, loadClassification(db, id)(id), getSettings(db).ideCommands),
    compose: { hasCompose: joined.facts.hasCompose, containers: joined.facts.containers },
    knownTags: loadKnownTags(db),
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

  const classificationOf = loadClassification(db);
  const { root, ideCommands } = getSettings(db);
  const parents = new Map(
    all.map(({ project, facts }) => [
      project.id,
      {
        name: classificationOf(project.id).meta?.displayName ?? project.name,
        folderName: project.name,
        sizeBytes: facts.sizeBytes,
      },
    ]),
  );

  const rows: RegistryRow[] = [];
  for (const joined of all) {
    const { project } = joined;
    // A group is only a heading for its children.
    if (project.kind === "group") continue;
    // Rows from a previous root stay in the database, ready if it is restored.
    if (!project.path.startsWith(`${root}/`)) continue;
    const parent = project.parentId ? (parents.get(project.parentId) ?? null) : null;
    rows.push(toRow(joined, parent, classificationOf(project.id), ideCommands));
  }

  const lastScan = db.select().from(scans).orderBy(desc(scans.id)).limit(1).get();
  return {
    rows,
    knownTags: loadKnownTags(db),
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
