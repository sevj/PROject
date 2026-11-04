import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEnv, readEnvFile, readProjectDoc } from "./project-files";

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
