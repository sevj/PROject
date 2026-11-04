import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../db/client";
import { projectFacts, projects } from "../db/schema";
import { dependencySize, parseDuOutput, readSize, runSizeScan } from "./size";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("size", () => {
  it("parses du output", () => {
    expect(parseDuOutput("4096\t/p/app\n")).toBe(4096);
    expect(parseDuOutput("")).toBeNull();
  });

  it("excludes dependencies, and returns null for a missing folder's empty output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-size-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.txt"), "x".repeat(10_000));
    const before = await readSize(dir);
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules", "big.bin"), "x".repeat(200_000));
    expect(await readSize(dir)).toBe(before);
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "big.bin"), "x".repeat(200_000));
    expect(await readSize(dir)).toBeGreaterThan(before ?? 0);
    expect(await readSize(join(dir, "nope"))).toBeNull();
  });

  it("excludes the given paths, even with characters that look like a pattern", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pm-size-"));
    dirs.push(dir);
    const excluded = join(dir, "odd[name]*");
    mkdirSync(excluded);
    const before = await readSize(dir, [excluded]);
    writeFileSync(join(excluded, "big.bin"), "x".repeat(200_000));
    expect(await readSize(dir, [excluded])).toBe(before);
    expect(await readSize(dir)).toBeGreaterThan(before ?? 0);
  });

  it("computes the dependency size, without ever going negative", () => {
    expect(dependencySize(500, 200)).toBe(300);
    expect(dependencySize(100, 200)).toBe(0);
    expect(dependencySize(null, 200)).toBeNull();
    expect(dependencySize(500, null)).toBeNull();
  });

  describe("runSizeScan", () => {
    function setup() {
      const dir = mkdtempSync(join(tmpdir(), "pm-size-"));
      dirs.push(dir);
      const db = openDb(":memory:");
      const add = (path: string, kind: "project" | "group", parentId: number | null, abandoned = false) => {
        mkdirSync(path, { recursive: true });
        const { id } = db.insert(projects).values({ path, name: path, kind, parentId, abandoned }).returning().get();
        db.insert(projectFacts).values({ projectId: id }).run();
        return id;
      };
      const group = add(join(dir, "group"), "group", null);
      const kept = add(join(dir, "group", "kept"), "project", group);
      const dropped = add(join(dir, "group", "dropped"), "project", group, true);
      const other = add(join(dir, "other"), "project", null);
      const size = (id: number) => db.select().from(projectFacts).all().find((f) => f.projectId === id)?.sizeBytes;
      return { dir, db, group, kept, dropped, other, size };
    }

    it("measures parent folders with their own files, but not abandoned sub-projects", async () => {
      const { dir, db, group, kept, dropped, size } = setup();
      await runSizeScan(db);
      const empty = size(group) ?? 0;

      writeFileSync(join(dir, "group", "dump.sql"), "x".repeat(300_000));
      writeFileSync(join(dir, "group", "kept", "a.bin"), "x".repeat(100_000));
      writeFileSync(join(dir, "group", "dropped", "b.bin"), "x".repeat(5_000_000));
      await runSizeScan(db);

      expect(size(group)).toBeGreaterThan(empty + 390_000);
      expect(size(group)).toBeLessThan(empty + 1_000_000);
      expect(size(kept)).toBeGreaterThan(90_000);
      expect(size(dropped)).toBeNull();
    });

    it("measures dependencies and .git on projects, not on parent folders", async () => {
      const { dir, db, group, kept } = setup();
      mkdirSync(join(dir, "group", "kept", "node_modules"));
      writeFileSync(join(dir, "group", "kept", "node_modules", "lib.js"), "x".repeat(400_000));
      mkdirSync(join(dir, "group", "kept", ".git"));
      writeFileSync(join(dir, "group", "kept", ".git", "HEAD"), "x".repeat(100_000));
      await runSizeScan(db);
      const facts = (id: number) => db.select().from(projectFacts).all().find((f) => f.projectId === id);
      expect(facts(kept)?.depsBytes).toBeGreaterThan(390_000);
      expect(facts(kept)?.gitBytes).toBeGreaterThan(90_000);
      expect(facts(group)?.depsBytes).toBeNull();
      expect(facts(group)?.gitBytes).toBeNull();
    });

    it("refreshes the parent along with a requested project, and nothing else", async () => {
      const { db, group, kept, other, size } = setup();
      await runSizeScan(db, [kept]);
      expect(size(kept)).not.toBeNull();
      expect(size(group)).not.toBeNull();
      expect(size(other)).toBeNull();
    });
  });
});
