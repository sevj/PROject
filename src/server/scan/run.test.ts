import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db/client";
import { projectFacts, projectMeta, projects, scans } from "../db/schema";
import { runScan } from "./run";

let root: string;
let db: Db;

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
    db.update(projects).set({ hidden: true }).where(eq(projects.id, id)).run();

    renameSync(join(root, "app"), join(root, "renamed"));
    await runScan(db, root);
    expect(row("app").project.missingAt).not.toBeNull();
    expect(row("renamed").project.missingAt).toBeNull();
    expect(db.select().from(projectMeta).get()?.note).toBe("reprendre ici");

    renameSync(join(root, "renamed"), join(root, "app"));
    await runScan(db, root);
    expect(row("app").project.id).toBe(id);
    expect(row("app").project.missingAt).toBeNull();
    expect(row("app").project.hidden).toBe(true);
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

  it("marks the scan as failed when the root does not exist, and clears stale runs", async () => {
    db.insert(scans).values({}).run();
    await expect(runScan(db, join(root, "nope"))).rejects.toThrow("n'existe pas");
    const rows = db.select().from(scans).all();
    expect(rows.map((s) => s.status)).toEqual(["failed", "failed"]);
    expect(rows[0].error).toBe("Scan interrompu");
  });
});
