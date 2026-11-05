import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCleanable, removeCleanable } from "./project-cleanup";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-cleanup-"));
  dirs.push(dir);
  return dir;
};
const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, stdio: "ignore" });

function project(ignored: string) {
  const dir = temp();
  git(dir, "init", "-q");
  writeFileSync(join(dir, ".gitignore"), ignored);
  git(dir, "add", ".gitignore");
  git(dir, "commit", "-q", "-m", "first");
  return dir;
}
const fill = (dir: string, name: string, bytes = 100_000) => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "file"), "x".repeat(bytes));
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readCleanable", () => {
  it("offers known folders that git ignores, the biggest first", async () => {
    const dir = project("node_modules/\nvar/\n");
    fill(dir, "node_modules");
    fill(dir, "var/cache", 300_000);
    const found = await readCleanable(dir);
    expect(found.map(({ name, kind }) => [name, kind])).toEqual([
      ["var/cache", "cache"],
      ["node_modules", "dependencies"],
    ]);
    expect(found[0].bytes).toBeGreaterThanOrEqual(300_000);
  });

  it("never offers `var` itself, which can hold real data", async () => {
    const dir = project("var/\n");
    fill(dir, "var/data");
    expect(await readCleanable(dir)).toEqual([]);
  });

  it("leaves out a folder git does not ignore, or that holds tracked files", async () => {
    const dir = project("build/\n");
    fill(dir, "dist");
    fill(dir, "build");
    git(dir, "add", "-f", "build/file");
    git(dir, "commit", "-q", "-m", "tracked");
    expect(await readCleanable(dir)).toEqual([]);
  });

  it("leaves out a link, wherever it leads", async () => {
    const dir = project("node_modules\n");
    const elsewhere = temp();
    fill(elsewhere, "precious");
    symlinkSync(join(elsewhere, "precious"), join(dir, "node_modules"));
    expect(await readCleanable(dir)).toEqual([]);
  });

  it("offers nothing outside a repository", async () => {
    const dir = temp();
    fill(dir, "node_modules");
    expect(await readCleanable(dir)).toEqual([]);
  });
});

describe("removeCleanable", () => {
  it("removes what was asked and says how much it freed", async () => {
    const dir = project("node_modules/\nvendor/\n");
    fill(dir, "node_modules");
    fill(dir, "vendor");
    const { freedBytes, failures } = await removeCleanable(dir, ["vendor"]);
    expect(failures).toEqual([]);
    expect(freedBytes).toBeGreaterThanOrEqual(100_000);
    expect(existsSync(join(dir, "vendor"))).toBe(false);
    expect(existsSync(join(dir, "node_modules"))).toBe(true);
  });

  it("refuses anything that is not offered", async () => {
    const dir = project("node_modules/\n");
    fill(dir, "src");
    fill(dir, "node_modules");
    const { freedBytes } = await removeCleanable(dir, ["src", "..", ".git", "../..", "node_modules/../src"]);
    expect(freedBytes).toBe(0);
    expect(existsSync(join(dir, "src"))).toBe(true);
    expect(existsSync(join(dir, ".git"))).toBe(true);
  });

  it("does not follow a link replaced since the page was opened", async () => {
    const dir = project("vendor\n");
    const elsewhere = temp();
    fill(elsewhere, "precious");
    symlinkSync(join(elsewhere, "precious"), join(dir, "vendor"));
    expect((await removeCleanable(dir, ["vendor"])).freedBytes).toBe(0);
    expect(existsSync(join(elsewhere, "precious", "file"))).toBe(true);
  });
});
