import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDuOutput, readSize } from "./size";

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
});
