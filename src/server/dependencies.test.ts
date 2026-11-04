import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db/client";
import { projects } from "./db/schema";
import { detectTargets, readDependencies, readDependencyCounters } from "./dependencies";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-deps-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (path: string, content = "{}") => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), content);
};

describe("detectTargets", () => {
  it("picks the manager from packageManager, then from the lock file", async () => {
    write("package.json", JSON.stringify({ packageManager: "pnpm@10.0.0" }));
    write("backend/composer.json");
    write("web/package.json");
    write("web/yarn.lock", "");
    write("api/package.json");
    write("node_modules/x/package.json");
    expect((await detectTargets(dir)).map(({ ecosystem, folder }) => `${ecosystem}:${folder}`).sort()).toEqual([
      "composer:backend",
      "npm:api",
      "pnpm:.",
      "yarn:web",
    ]);
  });

  it("finds nothing in a folder without manifests", async () => {
    expect(await detectTargets(dir)).toEqual([]);
  });
});

describe("stored analyses", () => {
  it("are empty before the first analysis", () => {
    const db = openDb(":memory:");
    db.insert(projects).values({ path: "/p", name: "p" }).run();
    expect(readDependencies(db, 1)).toBeNull();
    expect(readDependencyCounters(db).size).toBe(0);
  });
});
