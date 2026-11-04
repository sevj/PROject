import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db/client";
import { projectFacts, projectMeta, projects, scans } from "../db/schema";
import { setAbandoned } from "../classification";
import { getSettings, saveSettings } from "../settings";
import { rescanProject, runScan as realRunScan } from "./run";

let root: string;
let db: Db;

const noDocker = async () => ({ containers: [], error: null });
const runScan = (target: Db, path: string) => realRunScan(target, path, { docker: noDocker });

function make(relative: string, content = "{}") {
  const path = join(root, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function row(name: string) {
  const project = db.select().from(projects).where(eq(projects.name, name)).get();
  if (!project) throw new Error(`no project ${name}`);
  const facts = db.select().from(projectFacts).where(eq(projectFacts.projectId, project.id)).get();
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

describe("runScan", () => {
  it("detects stacks, compose files, docs and env file names", async () => {
    make("app/composer.json");
    make("app/package.json");
    make("app/docker-compose.override.yaml", "");
    make("app/README.md", "");
    make("app/docs/API.md", "");
    make("app/.env.local", "SECRET=value");
    await runScan(db, root);

    const { project, facts } = row("app");
    expect(project.kind).toBe("project");
    expect(facts?.stacks.sort()).toEqual(["Node", "PHP"]);
    expect(facts?.hasCompose).toBe(true);
    expect(facts?.docs).toEqual(["README.md", "docs/API.md"]);
    expect(facts?.envFiles).toEqual([".env.local"]);
    expect(JSON.stringify(facts)).not.toContain("SECRET");
  });

  it("records tooling, and reads it from subfolders when the root has no manifest", async () => {
    make("app/composer.json", JSON.stringify({ description: "Mon appli", require: { php: "^8" } }));
    make("app/composer.lock");
    mkdirSync(join(root, "mono"));
    execFileSync("git", ["init", "-q"], { cwd: join(root, "mono") });
    make("mono/.gitlab-ci.yml", "");
    make("mono/front/package.json", JSON.stringify({ dependencies: { next: "16" } }));
    make("mono/front/pnpm-lock.yaml", "");
    await runScan(db, root);

    expect(row("app").facts).toMatchObject({
      versions: [{ label: "PHP", value: "^8" }],
      packageManagers: ["Composer"],
      manifestDescription: "Mon appli",
    });
    expect(row("mono").facts).toMatchObject({
      versions: [{ label: "Next.js", value: "16" }],
      packageManagers: ["pnpm"],
      ci: ["GitLab CI"],
    });
  });

  it("reads the stack of a repository from its subfolders", async () => {
    mkdirSync(join(root, "mono"));
    execFileSync("git", ["init", "-q"], { cwd: join(root, "mono") });
    make("mono/backend/composer.json");
    make("mono/frontend/package.json");
    await runScan(db, root);
    expect(row("mono").facts?.stacks).toEqual(["Node", "PHP"]);
    expect(row("mono").facts?.hasGit).toBe(true);
    expect(db.select().from(projects).all()).toHaveLength(1);
  });

  it("ignores an empty .git folder and finds the projects below it", async () => {
    mkdirSync(join(root, "suite", ".git"), { recursive: true });
    make("suite/core/composer.json");
    make("suite/web/package.json");
    await runScan(db, root);

    expect(row("suite").project.kind).toBe("group");
    expect(row("suite").facts?.scanError).toBeNull();
    expect(row("core").project.parentId).toBe(row("suite").project.id);
    expect(row("web").project.parentId).toBe(row("suite").project.id);
  });

  it("keeps a valid repository as one project, even with projects inside", async () => {
    mkdirSync(join(root, "mono"));
    execFileSync("git", ["init", "-q"], { cwd: join(root, "mono") });
    make("mono/sub/package.json");
    await runScan(db, root);

    expect(row("mono").project.kind).toBe("project");
    expect(db.select().from(projects).all()).toHaveLength(1);
  });

  it("counts a .git file as a repository", async () => {
    make("worktree/.git", "gitdir: /nowhere\n");
    await runScan(db, root);
    expect(row("worktree").project.kind).toBe("project");
    expect(row("worktree").facts?.hasGit).toBe(true);
  });

  it("treats a folder with a Makefile as one project, not as a group", async () => {
    make("sim/Makefile", "");
    make("sim/rust/Cargo.toml");
    make("sim/godot/project.godot");
    await runScan(db, root);
    expect(row("sim").project.kind).toBe("project");
    expect(row("sim").facts?.stacks).toEqual(["Godot", "Rust"]);
    expect(db.select().from(projects).all()).toHaveLength(1);
  });

  it("creates a group for a folder of projects and links its children", async () => {
    make("platform/core/composer.json");
    make("platform/form/composer.json");
    make("platform/.idea/x.xml", "");
    await runScan(db, root);

    const group = row("platform").project;
    expect(group.kind).toBe("group");
    expect(row("core").project.parentId).toBe(group.id);
    expect(row("form").project.parentId).toBe(group.id);
  });

  it("keeps a plain folder, skips dot folders and does not follow symlinks", async () => {
    mkdirSync(join(root, "objectifs"));
    mkdirSync(join(root, ".idea"));
    make("real/package.json");
    symlinkSync(join(root, "real"), join(root, "link"));
    await runScan(db, root);

    expect(row("objectifs").project.kind).toBe("folder");
    expect(
      db.select().from(projects).all().map((p) => p.name).sort(),
    ).toEqual(["objectifs", "real"]);
  });

  it("records an unreadable folder without stopping the scan", async () => {
    make("ok/package.json");
    mkdirSync(join(root, "locked"));
    chmodSync(join(root, "locked"), 0o000);
    const result = await runScan(db, root);
    chmodSync(join(root, "locked"), 0o755);

    expect(row("locked").facts?.scanError).toBe("EACCES");
    expect(row("ok").facts?.scanError).toBeNull();
    expect(result.errorCount).toBe(1);
  });

  it("keeps the user's data across rescans and when a folder disappears", async () => {
    make("app/package.json");
    await runScan(db, root);
    const { id } = row("app").project;
    db.insert(projectMeta).values({ projectId: id, note: "reprendre ici" }).run();

    renameSync(join(root, "app"), join(root, "renamed"));
    await runScan(db, root);
    expect(row("app").project.missingAt).not.toBeNull();
    expect(row("renamed").project.missingAt).toBeNull();
    expect(db.select().from(projectMeta).get()?.note).toBe("reprendre ici");

    renameSync(join(root, "renamed"), join(root, "app"));
    await runScan(db, root);
    expect(row("app").project.id).toBe(id);
    expect(row("app").project.missingAt).toBeNull();
    expect(row("renamed").project.missingAt).not.toBeNull();
  });

  it("leaves containers and size to their own steps", async () => {
    make("app/package.json");
    await runScan(db, root);
    const { id } = row("app").project;
    db.update(projectFacts).set({ sizeBytes: 42 }).where(eq(projectFacts.projectId, id)).run();
    await runScan(db, root);
    expect(row("app").facts?.sizeBytes).toBe(42);
  });

  it("attaches containers to their project and clears them once gone", async () => {
    make("app/docker-compose.yml", "");
    make("other/package.json");
    const container = {
      name: "app-db",
      service: "db",
      state: "running",
      status: "Up",
      ports: "",
      workingDir: join(root, "app", "deploy"),
    };
    await realRunScan(db, root, { docker: async () => ({ containers: [container], error: null }) });
    expect(row("app").facts?.containers).toEqual([container]);
    expect(row("other").facts?.containers).toEqual([]);

    await runScan(db, root);
    expect(row("app").facts?.containers).toEqual([]);
  });

  it("keeps scanning when Docker is unavailable and records a warning", async () => {
    make("app/package.json");
    await realRunScan(db, root, { docker: async () => ({ containers: [], error: "daemon down" }) });
    const scan = db.select().from(scans).get();
    expect(scan?.status).toBe("done");
    expect(scan?.warning).toBe("daemon down");
  });

  it("refreshes one project without touching the others or the user's data", async () => {
    make("app/package.json");
    make("other/package.json");
    await runScan(db, root);
    const { id } = row("app").project;
    db.insert(projectMeta).values({ projectId: id, note: "garder" }).run();

    make("app/composer.json");
    make("other/composer.json");
    expect(await rescanProject(db, id, { docker: noDocker })).toBe(true);

    expect(row("app").facts?.stacks.sort()).toEqual(["Node", "PHP"]);
    expect(row("other").facts?.stacks).toEqual(["Node"]);
    expect(db.select().from(projectMeta).get()?.note).toBe("garder");
  });

  it("never opens an abandoned project again, and keeps its data as it was", async () => {
    make("app/package.json");
    make("group/child/package.json");
    make("group/other/package.json");
    saveSettings(db, { root });
    await realRunScan(db, getSettings(db).root, { docker: noDocker });
    const app = row("app").project.id;
    const child = row("child").project.id;
    setAbandoned(db, [app, child], true);

    make("app/composer.json");
    make("group/child/composer.json");
    make("other/package.json");
    await realRunScan(db, getSettings(db).root, { docker: noDocker });

    expect(row("app").facts?.stacks).toEqual(["Node"]);
    expect(row("child").facts?.stacks).toEqual(["Node"]);
    expect(row("app").project.abandoned).toBe(true);
    expect(row("other").project.kind).toBe("project");
    expect(await rescanProject(db, app, { docker: noDocker })).toBe(false);
    expect(row("app").facts?.stacks).toEqual(["Node"]);

    rmSync(join(root, "app"), { recursive: true });
    await realRunScan(db, getSettings(db).root, { docker: noDocker });
    expect(row("app").project.missingAt).toBeNull();

    setAbandoned(db, [child], false);
    await realRunScan(db, getSettings(db).root, { docker: noDocker });
    expect(row("child").facts?.stacks.sort()).toEqual(["Node", "PHP"]);
  });

  it("does not attach containers to an abandoned project", async () => {
    make("app/docker-compose.yml", "");
    await runScan(db, root);
    setAbandoned(db, [row("app").project.id], true);
    const container = {
      name: "c",
      service: "c",
      state: "running",
      status: "Up",
      ports: "",
      workingDir: join(root, "app"),
    };
    await realRunScan(db, root, { docker: async () => ({ containers: [container], error: null }) });
    expect(row("app").facts?.containers).toEqual([]);
  });

  it("marks a project as missing when refreshing a deleted folder", async () => {
    make("app/package.json");
    await runScan(db, root);
    const { id } = row("app").project;
    rmSync(join(root, "app"), { recursive: true });

    expect(await rescanProject(db, id, { docker: noDocker })).toBe(false);
    expect(row("app").project.missingAt).not.toBeNull();
    expect(await rescanProject(db, 9999, { docker: noDocker })).toBe(false);
  });

  it("marks the scan as failed when the root does not exist, and clears stale runs", async () => {
    db.insert(scans).values({}).run();
    await expect(runScan(db, join(root, "nope"))).rejects.toThrow("n'existe pas");
    const rows = db.select().from(scans).all();
    expect(rows.map((s) => s.status)).toEqual(["failed", "failed"]);
    expect(rows[0].error).toBe("Scan interrompu");
  });
});
