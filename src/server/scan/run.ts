import { and, eq, inArray, isNull } from "drizzle-orm";
import { existsSync } from "node:fs";
import type { Db } from "../db/client";
import { projectFacts, projects, scans } from "../db/schema";
import { type DetectedFolder, readFolder } from "./detect";
import { assignContainers, type DockerState, readDocker } from "./docker";
import { type GitFacts, readGitFacts } from "./git";
import { mapLimit } from "./limit";

const GIT_CONCURRENCY = 8;

/** Stored as is, and put into words when shown. */
export const REFRESH_INTERRUPTED = "interrupted";

type Options = { docker?: () => Promise<DockerState> };
type Scanned = { folder: DetectedFolder; git: GitFacts | null; error: string | null };
type Target = typeof projects.$inferSelect;

async function scanFolder(folder: DetectedFolder): Promise<Scanned> {
  if (!folder.hasGit) return { folder, git: null, error: folder.error };
  try {
    return { folder, git: await readGitFacts(folder.path), error: folder.error };
  } catch (error) {
    const message = (error as { stderr?: string }).stderr?.trim() || String(error);
    return { folder, git: null, error: message };
  }
}

/** Containers and size are written by their own steps, so they are not part of this write. */
function saveFacts(db: Db, projectId: number, { folder, git, error }: Scanned, now: Date) {
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
    .values({ projectId, ...facts })
    .onConflictDoUpdate({ target: projectFacts.projectId, set: facts })
    .run();
}

/** Only ever opens the given folders: nothing is discovered. */
async function refresh(db: Db, targets: Target[], docker: () => Promise<DockerState>) {
  const now = new Date();
  const present = targets.filter(({ path }) => existsSync(path));
  const presentIds = new Set(present.map(({ id }) => id));
  const gone = targets.filter(({ id }) => !presentIds.has(id));

  const [scanned, dockerState] = await Promise.all([
    mapLimit(
      present.filter(({ kind }) => kind === "project"),
      GIT_CONCURRENCY,
      async ({ id, path, name }) => ({ id, path, result: await scanFolder(await readFolder(path, name)) }),
    ),
    docker(),
  ]);

  const known = db
    .select({ path: projects.path })
    .from(projects)
    .where(and(eq(projects.kind, "project"), eq(projects.abandoned, false)))
    .all()
    .map(({ path }) => path);
  const assigned = assignContainers(known, dockerState.containers);

  db.transaction((tx) => {
    for (const { id } of present) {
      tx.update(projects).set({ lastSeenAt: now, missingAt: null }).where(eq(projects.id, id)).run();
    }
    for (const { id, path, result } of scanned) {
      saveFacts(tx as unknown as Db, id, result, now);
      tx.update(projectFacts)
        .set({ containers: assigned.get(path) ?? [] })
        .where(eq(projectFacts.projectId, id))
        .run();
    }
    for (const { id } of gone) {
      // Keeps the first date, and the row: the user's data must survive a moved folder.
      tx.update(projects)
        .set({ missingAt: now })
        .where(and(eq(projects.id, id), isNull(projects.missingAt)))
        .run();
      tx.update(projectFacts).set({ containers: [] }).where(eq(projectFacts.projectId, id)).run();
    }
  });

  return {
    projectCount: targets.filter(({ kind }) => kind === "project").length,
    errorCount: gone.length + scanned.filter(({ result }) => result.error !== null).length,
    warning: dockerState.error,
  };
}

/** Refreshes the given projects, leaving aside the abandoned ones. */
export async function refreshProjects(
  db: Db,
  projectIds: number[],
  { docker = readDocker }: Options = {},
): Promise<void> {
  if (projectIds.length === 0) return;
  const targets = db
    .select()
    .from(projects)
    .where(and(inArray(projects.id, projectIds), eq(projects.abandoned, false)))
    .all();
  if (targets.length > 0) await refresh(db, targets, docker);
}

/** Refreshes one project. False when its folder is gone, or when it is abandoned. */
export async function rescanProject(db: Db, projectId: number, options: Options = {}): Promise<boolean> {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project || project.abandoned) return false;
  await refreshProjects(db, [projectId], options);
  return existsSync(project.path);
}

export type RefreshResult = { scanId: number; projectCount: number; errorCount: number };

/** Refreshes every project of the list. */
export async function refreshAll(
  db: Db,
  { now = new Date(), docker = readDocker }: Options & { now?: Date } = {},
): Promise<RefreshResult> {
  // A running row can only be a leftover here: the server stopped during that refresh.
  db.update(scans)
    .set({ status: "failed", finishedAt: now, error: REFRESH_INTERRUPTED })
    .where(eq(scans.status, "running"))
    .run();
  const { id: scanId } = db.insert(scans).values({ startedAt: now }).returning().get();

  try {
    const targets = db.select().from(projects).where(eq(projects.abandoned, false)).all();
    const { warning, ...result } = await refresh(db, targets, docker);
    db.update(scans)
      .set({ status: "done", finishedAt: new Date(), warning, ...result })
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
