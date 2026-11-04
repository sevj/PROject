import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAbandoned } from "../classification";
import { type Db, openDb } from "../db/client";
import { projectFacts, projectMeta, projects, scans } from "../db/schema";
import { refreshAll as realRefreshAll, refreshProjects, rescanProject } from "./run";

let root: string;
let db: Db;

const noDocker = async () => ({ containers: [], error: null });
const refreshAll = () => realRefreshAll(db, { docker: noDocker });

function make(relative: string, content = "{}") {
  const path = join(root, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function register(relative: string, kind: "project" | "group" = "project", parentId: number | null = null): number {
  const path = join(root, relative);
  mkdirSync(path, { recursive: true });
  const { id } = db.insert(projects).values({ path, name: relative, kind, parentId }).returning().get();
  db.insert(projectFacts).values({ projectId: id }).run();
  return id;
}

function row(id: number) {
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  const facts = db.select().from(projectFacts).where(eq(projectFacts.projectId, id)).get();
  return { project, facts };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pm-scan-"));
  db = openDb(":memory:");
});

afterEach(() => {
  chmodSync(root, 0o755);
  rmSync(root, { recursive: true, force: true });
});

describe("refreshAll", () => {
  it("only reads the projects of the list, and discovers nothing", async () => {
    const app = register("app");
    make("app/package.json");
    make("other/package.json");
    make("app/sub/package.json");
    await refreshAll();
    expect(db.select().from(projects).all().map(({ id }) => id)).toEqual([app]);
    expect(row(app).facts?.stacks).toEqual(["Node"]);
  });

  it("reads stacks, compose files, docs and env file names", async () => {
    const app = register("app");
    make("app/composer.json");
    make("app/package.json");
    make("app/docker-compose.override.yaml", "");
    make("app/README.md", "");
    make("app/docs/API.md", "");
    make("app/.env.local", "SECRET=value");
    await refreshAll();

    const { facts } = row(app);
    expect(facts?.stacks.sort()).toEqual(["Node", "PHP"]);
    expect(facts?.hasCompose).toBe(true);
    expect(facts?.docs).toEqual(["README.md", "docs/API.md"]);
    expect(facts?.envFiles).toEqual([".env.local"]);
    expect(JSON.stringify(facts)).not.toContain("SECRET");
  });

  it("records tooling, and reads it from subfolders when the root has no manifest", async () => {
    const app = register("app");
    make("app/composer.json", JSON.stringify({ description: "Mon appli", require: { php: "^8" } }));
    make("app/composer.lock");
    const mono = register("mono");
    execFileSync("git", ["init", "-q"], { cwd: join(root, "mono") });
    make("mono/.gitlab-ci.yml", "");
    make("mono/front/package.json", JSON.stringify({ dependencies: { next: "16" } }));
    make("mono/front/pnpm-lock.yaml", "");
    await refreshAll();

    expect(row(app).facts).toMatchObject({
      versions: [{ label: "PHP", value: "^8" }],
      packageManagers: ["Composer"],
      manifestDescription: "Mon appli",
    });
    expect(row(mono).facts).toMatchObject({
      versions: [{ label: "Next.js", value: "16" }],
      packageManagers: ["pnpm"],
      ci: ["GitLab CI"],
      hasGit: true,
    });
  });

  it("accepts a folder without any marker or repository", async () => {
    const notes = register("notes");
    await refreshAll();
    expect(row(notes).facts).toMatchObject({ stacks: [], hasGit: false, scanError: null });
  });

  it("does not count an empty .git folder as a repository, but counts a .git file", async () => {
    const empty = register("empty");
    mkdirSync(join(root, "empty", ".git"));
    const worktree = register("worktree");
    make("worktree/.git", "gitdir: /nowhere\n");
    await refreshAll();
    expect(row(empty).facts?.hasGit).toBe(false);
    expect(row(worktree).facts?.hasGit).toBe(true);
  });

  it("records an unreadable folder without stopping the others", async () => {
    const ok = register("ok");
    const locked = register("locked");
    chmodSync(join(root, "locked"), 0o000);
    const result = await refreshAll();
    chmodSync(join(root, "locked"), 0o755);

    expect(row(locked).facts?.scanError).toBe("EACCES");
    expect(row(ok).facts?.scanError).toBeNull();
    expect(result.errorCount).toBe(1);
  });

  it("flags a folder that disappears, keeps the user's data, and clears the flag when it returns", async () => {
    const app = register("app");
    await refreshAll();
    db.insert(projectMeta).values({ projectId: app, note: "reprendre ici" }).run();

    renameSync(join(root, "app"), join(root, "renamed"));
    await refreshAll();
    expect(row(app).project?.missingAt).not.toBeNull();
    expect(db.select().from(projectMeta).get()?.note).toBe("reprendre ici");

    renameSync(join(root, "renamed"), join(root, "app"));
    await refreshAll();
    expect(row(app).project?.missingAt).toBeNull();
  });

  it("checks a multi-project's folder without giving it facts", async () => {
    const group = register("suite", "group");
    const child = register("suite/core", "project", group);
    make("suite/package.json");
    make("suite/core/package.json");
    await refreshAll();
    expect(row(group).facts?.stacks).toEqual([]);
    expect(row(child).facts?.stacks).toEqual(["Node"]);

    rmSync(join(root, "suite"), { recursive: true });
    await refreshAll();
    expect(row(group).project?.missingAt).not.toBeNull();
    expect(row(child).project?.missingAt).not.toBeNull();
  });

  it("leaves the size to its own step", async () => {
    const app = register("app");
    db.update(projectFacts).set({ sizeBytes: 42 }).where(eq(projectFacts.projectId, app)).run();
    await refreshAll();
    expect(row(app).facts?.sizeBytes).toBe(42);
  });

  it("attaches containers to their project and clears them once gone", async () => {
    const app = register("app");
    const other = register("other");
    const container = {
      name: "app-db",
      service: "db",
      state: "running",
      status: "Up",
      ports: "",
      workingDir: join(root, "app", "deploy"),
    };
    await realRefreshAll(db, { docker: async () => ({ containers: [container], error: null }) });
    expect(row(app).facts?.containers).toEqual([container]);
    expect(row(other).facts?.containers).toEqual([]);

    await refreshAll();
    expect(row(app).facts?.containers).toEqual([]);
  });

  it("keeps going when Docker is unavailable and records a warning", async () => {
    register("app");
    await realRefreshAll(db, { docker: async () => ({ containers: [], error: "daemon down" }) });
    expect(db.select().from(scans).get()).toMatchObject({ status: "done", warning: "daemon down" });
  });

  it("clears a run left over by a stopped server", async () => {
    db.insert(scans).values({}).run();
    await refreshAll();
    const rows = db.select().from(scans).all();
    expect(rows.map((scan) => scan.status)).toEqual(["failed", "done"]);
    expect(rows[0].error).toBe("interrupted");
  });

  it("never opens an abandoned project, even once its folder is gone", async () => {
    const app = register("app");
    make("app/package.json");
    await refreshAll();
    setAbandoned(db, [app], true);

    make("app/composer.json");
    await refreshAll();
    expect(row(app).facts?.stacks).toEqual(["Node"]);
    expect(await rescanProject(db, app, { docker: noDocker })).toBe(false);
    expect(row(app).facts?.stacks).toEqual(["Node"]);

    rmSync(join(root, "app"), { recursive: true });
    await refreshAll();
    expect(row(app).project?.missingAt).toBeNull();
  });

  it("does not attach containers to an abandoned project", async () => {
    const app = register("app");
    setAbandoned(db, [app], true);
    const container = { name: "c", service: "c", state: "running", status: "Up", ports: "", workingDir: join(root, "app") };
    await realRefreshAll(db, { docker: async () => ({ containers: [container], error: null }) });
    expect(row(app).facts?.containers).toEqual([]);
  });
});

describe("refreshProjects", () => {
  it("touches only the given projects and none of the user's data", async () => {
    const app = register("app");
    const other = register("other");
    make("app/package.json");
    make("other/package.json");
    await refreshAll();
    db.insert(projectMeta).values({ projectId: app, note: "garder" }).run();

    make("app/composer.json");
    make("other/composer.json");
    await refreshProjects(db, [app], { docker: noDocker });

    expect(row(app).facts?.stacks.sort()).toEqual(["Node", "PHP"]);
    expect(row(other).facts?.stacks).toEqual(["Node"]);
    expect(db.select().from(projectMeta).get()?.note).toBe("garder");
    expect(db.select().from(scans).all()).toHaveLength(1);
  });
});

describe("rescanProject", () => {
  it("says when the folder is gone, or the project unknown", async () => {
    const app = register("app");
    expect(await rescanProject(db, app, { docker: noDocker })).toBe(true);
    rmSync(join(root, "app"), { recursive: true });
    expect(await rescanProject(db, app, { docker: noDocker })).toBe(false);
    expect(row(app).project?.missingAt).not.toBeNull();
    expect(await rescanProject(db, 9999, { docker: noDocker })).toBe(false);
  });
});
