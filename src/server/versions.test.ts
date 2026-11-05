import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "./db/client";
import { readProjectVersions, readReleases } from "./versions";

let dir: string;
let db: Db;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-versions-"));
  mkdirSync(join(dir, "site"));
  writeFileSync(join(dir, "site", "composer.json"), JSON.stringify({ require: { php: "^8.1" } }));
  writeFileSync(join(dir, "site", "composer.lock"), JSON.stringify({ packages: [{ name: "symfony/framework-bundle", version: "v6.4.13" }] }));
  writeFileSync(join(dir, "site", ".nvmrc"), "20\n");
  writeFileSync(join(dir, "site", "compose.yaml"), "services:\n  db:\n    image: mariadb:10.6\n");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  db = openDb(":memory:");
});

describe("readProjectVersions", () => {
  it("reads the files and images, the surest first", async () => {
    const versions = await readProjectVersions(join(dir, "site"), ["php:8.3-fpm"]);
    expect(versions.map(({ product, version, source }) => [product, version, source])).toEqual([
      ["php", "8.3", "image"],
      ["symfony", "6.4.13", "lock"],
      ["nodejs", "20", "nvmrc"],
      ["mariadb", "10.6", "image"],
    ]);
  });

  it("finds nothing in an empty folder", async () => {
    expect(await readProjectVersions(dir, [])).toEqual([]);
  });
});

describe("readReleases", () => {
  const answer = { result: { releases: [{ name: "8.3", eoasFrom: "2025-12-31", eolFrom: "2027-12-31", latest: { name: "8.3.36" } }] } };

  it("keeps a copy for a day, and keeps it when endoflife.date cannot be reached", async () => {
    const fetcher = vi.fn(async () => answer);
    const now = Date.parse("2026-11-05");
    expect((await readReleases(db, ["php"], { now, fetcher })).releases.get("php")?.[0].name).toBe("8.3");
    await readReleases(db, ["php"], { now: now + 3_600_000, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("https://endoflife.date/api/v1/products/php");

    const down = vi.fn(async () => {
      throw new Error("offline");
    });
    const later = await readReleases(db, ["php"], { now: now + 2 * 86_400_000, fetcher: down });
    expect(later).toMatchObject({ failed: ["php"], fetchedAt: now });
    expect(later.releases.get("php")).toHaveLength(1);
  });
});
