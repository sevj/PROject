import { desc, eq } from "drizzle-orm";
import { homedir } from "node:os";
import type { RegistryRow } from "@/lib/registry";
import type { Db } from "./db/client";
import { projectFacts, projects, scans } from "./db/schema";

function displayPath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function getRegistry(db: Db) {
  const all = db
    .select({ project: projects, facts: projectFacts })
    .from(projects)
    .innerJoin(projectFacts, eq(projectFacts.projectId, projects.id))
    .all();
  const names = new Map(all.map(({ project }) => [project.id, project.name]));

  const rows: RegistryRow[] = [];
  for (const { project, facts } of all) {
    // A group is only a heading for its children, and hidden folders are the user's call.
    if (project.kind === "group" || project.hidden) continue;
    rows.push({
      id: project.id,
      name: project.name,
      path: displayPath(project.path),
      parentName: project.parentId ? (names.get(project.parentId) ?? null) : null,
      kind: project.kind,
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
    });
  }

  const lastScan = db.select().from(scans).orderBy(desc(scans.id)).limit(1).get();
  return {
    rows,
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
