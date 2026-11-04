import { and, eq, isNull, like, notInArray, or } from "drizzle-orm";
import { existsSync } from "node:fs";
import type { Db } from "../db/client";
import { projectFacts, projects, scans } from "../db/schema";
import { type DetectedFolder, detectFolder, detectFolders } from "./detect";
import { assignContainers, type DockerState, readDocker } from "./docker";
import { type GitFacts, readGitFacts } from "./git";
import { mapLimit } from "./limit";

const GIT_CONCURRENCY = 8;

type Scanned = { folder: DetectedFolder; git: GitFacts | null; error: string | null };

async function scanFolder(folder: DetectedFolder): Promise<Scanned> {
  if (!folder.hasGit) return { folder, git: null, error: folder.error };
  try {
    return { folder, git: await readGitFacts(folder.path), error: folder.error };
  } catch (error) {
    const message = (error as { stderr?: string }).stderr?.trim() || String(error);
    return { folder, git: null, error: message };
  }
}

function saveFolder(db: Db, { folder, git, error }: Scanned, parentId: number | null, now: Date): number {
  const { id } = db
    .insert(projects)
    .values({ path: folder.path, name: folder.name, kind: folder.kind, parentId, lastSeenAt: now })
    .onConflictDoUpdate({
      target: projects.path,
      // `abandoned` belongs to the user and stays untouched.
      set: { name: folder.name, kind: folder.kind, parentId, lastSeenAt: now, missingAt: null },
    })
    .returning({ id: projects.id })
    .get();

  // Containers and size are written by their own steps, so they are not part of this write.
  const facts = {
    stacks: folder.stacks,
    hasGit: folder.hasGit,
    hasCompose: folder.hasCompose,
    docs: folder.docs,
    envFiles: folder.envFiles,
    versions: folder.tooling.versions,
    packageManagers: folder.tooling.packageManagers,
    ci: folder.tooling.ci,
    testTools: folder.tooling.testTools,
    manifestDescription: folder.tooling.description,
    branch: git?.branch ?? null,
    upstream: git?.upstream ?? null,
    ahead: git?.ahead ?? null,
    behind: git?.behind ?? null,
    dirtyCount: git?.dirtyCount ?? null,
    remoteUrl: git?.remoteUrl ?? null,
    commitCount: git?.commitCount ?? null,
    branchCount: git?.branchCount ?? null,
    stashCount: git?.stashCount ?? null,
    firstCommitAt: git?.firstCommitAt ?? null,
    lastCommitAuthor: git?.lastCommitAuthor ?? null,
    lastCommitAt: git?.lastCommitAt ?? null,
    lastCommitSubject: git?.lastCommitSubject ?? null,
    weeklyCommits: git?.weeklyCommits ?? null,
    scanError: error,
    scannedAt: now,
  };
  db.insert(projectFacts)
    .values({ projectId: id, ...facts })
    .onConflictDoUpdate({ target: projectFacts.projectId, set: facts })
    .run();
  return id;
}

/** Refreshes one project. False when its folder is gone, or when it is abandoned. */
export async function rescanProject(
  db: Db,
  projectId: number,
  { docker = readDocker }: { docker?: () => Promise<DockerState> } = {},
): Promise<boolean> {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project || project.abandoned) return false;
  const now = new Date();

  if (!existsSync(project.path)) {
    db.update(projects).set({ missingAt: now }).where(eq(projects.id, projectId)).run();
    return false;
  }

  const detected = await detectFolder(project.path, project.name);
  const folder = detected.find((item) => item.path === project.path);
  if (!folder) return false;

  const [scanned, dockerState] = await Promise.all([scanFolder(folder), docker()]);
  const known = db
    .select({ path: projects.path })
    .from(projects)
    .where(and(eq(projects.kind, "project"), eq(projects.abandoned, false)))
    .all()
    .map(({ path }) => path);

  db.transaction((tx) => {
    saveFolder(tx as unknown as Db, scanned, project.parentId, now);
    tx.update(projectFacts)
      .set({ containers: assignContainers(known, dockerState.containers).get(project.path) ?? [] })
      .where(eq(projectFacts.projectId, projectId))
      .run();
  });
  return true;
}

export type ScanResult = { scanId: number; projectCount: number; errorCount: number };

export async function runScan(
  db: Db,
  root: string,
  { now = new Date(), docker = readDocker }: { now?: Date; docker?: () => Promise<DockerState> } = {},
): Promise<ScanResult> {
  // A running row can only be a leftover here: the server stopped during that scan.
  db.update(scans)
    .set({ status: "failed", finishedAt: now, error: "Scan interrompu" })
    .where(eq(scans.status, "running"))
    .run();
  const { id: scanId } = db.insert(scans).values({ startedAt: now }).returning().get();

  try {
    const abandoned = new Set(
      db
        .select({ path: projects.path })
        .from(projects)
        .where(eq(projects.abandoned, true))
        .all()
        .map(({ path }) => path),
    );
    const [scanned, dockerState] = await Promise.all([
      detectFolders(root, abandoned).then((folders) => mapLimit(folders, GIT_CONCURRENCY, scanFolder)),
      docker(),
    ]);

    const result = db.transaction((tx) => {
      const ids = new Map<string, number>();
      // Top-level folders first: children need the id of their parent.
      const ordered = [...scanned].sort(
        (a, b) => Number(a.folder.parentPath !== null) - Number(b.folder.parentPath !== null),
      );
      for (const item of ordered) {
        const parentId = item.folder.parentPath ? (ids.get(item.folder.parentPath) ?? null) : null;
        ids.set(item.folder.path, saveFolder(tx as unknown as Db, item, parentId, now));
      }

      const assigned = assignContainers(
        scanned.filter((item) => item.folder.kind === "project").map((item) => item.folder.path),
        dockerState.containers,
      );
      for (const [path, id] of ids) {
        tx.update(projectFacts)
          .set({ containers: assigned.get(path) ?? [] })
          .where(eq(projectFacts.projectId, id))
          .run();
      }

      // Rows are kept: the user's classification must survive a folder that disappears.
      const seen = [...ids.values()];
      tx.update(projects)
        .set({ missingAt: now })
        .where(
          and(
            isNull(projects.missingAt),
            // Not looking at a folder says nothing about whether it still exists.
            eq(projects.abandoned, false),
            or(eq(projects.path, root), like(projects.path, `${root}/%`)),
            seen.length > 0 ? notInArray(projects.id, seen) : undefined,
          ),
        )
        .run();

      return {
        projectCount: scanned.filter((item) => item.folder.kind === "project").length,
        errorCount: scanned.filter((item) => item.error !== null).length,
      };
    });

    db.update(scans)
      .set({ status: "done", finishedAt: new Date(), warning: dockerState.error, ...result })
      .where(eq(scans.id, scanId))
      .run();
    return { scanId, ...result };
  } catch (error) {
    db.update(scans)
      .set({ status: "failed", finishedAt: new Date(), error: String(error) })
      .where(eq(scans.id, scanId))
      .run();
    throw error;
  }
}
