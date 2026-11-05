import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listProjectFolder, parseEnv, readEnvFile, readFolderSizes, readProjectDoc } from "./project-files";

let base: string;
let project: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "pm-files-"));
  project = join(base, "project");
  mkdirSync(join(project, "docs"), { recursive: true });
  writeFileSync(join(base, "secret.txt"), "outside");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("parseEnv", () => {
  it("handles comments, export, quotes and inline comments", () => {
    expect(
      parseEnv(
        [
          "# comment",
          "",
          "A=1",
          "export B = two ",
          'C="with # hash"',
          "D='single'",
          "E=value # note",
          "F=a=b",
          "G=",
          "not a variable",
          "H=x\r",
        ].join("\n"),
      ),
    ).toEqual([
      { key: "A", value: "1" },
      { key: "B", value: "two" },
      { key: "C", value: "with # hash" },
      { key: "D", value: "single" },
      { key: "E", value: "value" },
      { key: "F", value: "a=b" },
      { key: "G", value: "" },
      { key: "H", value: "x" },
    ]);
  });
});

describe("readEnvFile", () => {
  it("reads a root .env file", async () => {
    writeFileSync(join(project, ".env.local"), "TOKEN=abc\n");
    expect(await readEnvFile(project, ".env.local")).toEqual([{ key: "TOKEN", value: "abc" }]);
  });

  it.each(["../secret.txt", "../.env", "config.php", ".envrc", "docs/.env", ".env/../../secret.txt", ""])(
    "refuses the name %s",
    async (name) => {
      writeFileSync(join(base, ".env"), "OUTSIDE=1");
      writeFileSync(join(project, "config.php"), "x=1");
      expect(await readEnvFile(project, name)).toBeNull();
    },
  );

  it("refuses a symlink and a missing file", async () => {
    symlinkSync(join(base, "secret.txt"), join(project, ".env"));
    expect(await readEnvFile(project, ".env")).toBeNull();
    expect(await readEnvFile(project, ".env.test")).toBeNull();
  });
});

describe("readProjectDoc", () => {
  it("reads a document inside the project", async () => {
    writeFileSync(join(project, "docs", "a.md"), "# A");
    expect(await readProjectDoc(project, "docs/a.md")).toBe("# A");
  });

  it.each(["../secret.txt", "docs/../../secret.txt", "/etc/passwd"])("refuses %s", async (path) => {
    expect(await readProjectDoc(project, path)).toBeNull();
  });

  it("refuses a symlink leaving the project", async () => {
    symlinkSync(join(base, "secret.txt"), join(project, "README.md"));
    expect(await readProjectDoc(project, "README.md")).toBeNull();
  });
});

describe("readFolderSizes", () => {
  it("weighs the folders and the files of one level", async () => {
    const root = join(base, "sized");
    mkdirSync(join(root, "var", "cache"), { recursive: true });
    writeFileSync(join(root, "var", "cache", "big"), "x".repeat(200_000));
    writeFileSync(join(root, "small.txt"), "x");
    const sizes = await readFolderSizes(root, ".");
    expect(Object.keys(sizes ?? {}).sort()).toEqual(["small.txt", "var"]);
    expect(sizes?.var).toBeGreaterThanOrEqual(200_000);
    expect(Object.keys((await readFolderSizes(root, "var")) ?? {})).toEqual(["cache"]);
  });

  it("does not go out of the project", async () => {
    const outside = mkdtempSync(join(tmpdir(), "pm-outside-"));
    symlinkSync(outside, join(base, "link"));
    expect(await readFolderSizes(base, "..")).toBeNull();
    expect(await readFolderSizes(base, "link")).toBeNull();
    expect(await readFolderSizes(base, "/etc")).toBeNull();
    rmSync(outside, { recursive: true, force: true });
  });
});

describe("listProjectFolder", () => {
  const names = async (relative: string) => (await listProjectFolder(project, relative))?.entries.map(({ name }) => name);

  it("lists folders first, with sizes for files only, and goes down on request", async () => {
    mkdirSync(join(project, "src/deep"), { recursive: true });
    writeFileSync(join(project, "a.txt"), "12345");
    writeFileSync(join(project, ".env"), "SECRET=value");
    const listing = await listProjectFolder(project, ".");
    expect(listing?.entries.map(({ name, kind, sizeBytes }) => [name, kind, sizeBytes])).toEqual([
      ["docs", "directory", null],
      ["src", "directory", null],
      [".env", "file", 12],
      ["a.txt", "file", 5],
    ]);
    expect(JSON.stringify(listing)).not.toContain("SECRET");
    expect((await listProjectFolder(project, "src"))?.entries[0]).toMatchObject({ name: "deep", path: "src/deep" });
  });

  it("marks dependencies and .git as not to be opened", async () => {
    mkdirSync(join(project, "node_modules"));
    mkdirSync(join(project, ".git"));
    const listing = await listProjectFolder(project, ".");
    const opaque = listing?.entries.filter((entry) => entry.opaque).map(({ name }) => name);
    expect(opaque).toEqual([".git", "node_modules"]);
  });

  it("refuses anything outside the project, through a path or a link", async () => {
    expect(await listProjectFolder(project, "..")).toBeNull();
    expect(await listProjectFolder(project, "docs/../..")).toBeNull();
    expect(await listProjectFolder(project, base)).toBeNull();
    symlinkSync(base, join(project, "out"));
    expect(await names("out")).toBeUndefined();
    const link = (await listProjectFolder(project, "."))?.entries.find(({ name }) => name === "out");
    expect(link?.kind).toBe("link");
  });

  it("returns null for a folder that does not exist, and caps a huge one", async () => {
    expect(await listProjectFolder(project, "nope")).toBeNull();
    mkdirSync(join(project, "many"));
    for (let index = 0; index < 505; index += 1) writeFileSync(join(project, "many", `${index}.txt`), "");
    const listing = await listProjectFolder(project, "many");
    expect(listing?.entries).toHaveLength(500);
    expect(listing?.hiddenCount).toBe(5);
  });
});
