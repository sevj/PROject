import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listDirectories } from "./directory-browser";

let root: string;
const names = (path: string, within?: string) => listDirectories(path, within).entries.map(({ name }) => name);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pm-browse-"));
  mkdirSync(join(root, "b/inner"), { recursive: true });
  mkdirSync(join(root, "a"));
  mkdirSync(join(root, ".hidden"));
  writeFileSync(join(root, "file.txt"), "");
  symlinkSync(join(root, "a"), join(root, "link"));
  symlinkSync(join(root, "file.txt"), join(root, "link-to-file"));
});

afterEach(() => {
  chmodSync(root, 0o755);
  rmSync(root, { recursive: true, force: true });
});

describe("listDirectories", () => {
  it("lists visible folders in order, links to folders included, and never files", () => {
    expect(names(root)).toEqual(["a", "b", "link"]);
    expect(listDirectories(root).parent).toBe(dirname(root));
  });

  it("starts from the home folder and understands ~", () => {
    expect(listDirectories("").path).toBe(homedir());
    expect(listDirectories("~").value).toBe("~");
  });

  it("falls back to the nearest folder for a path that does not exist", () => {
    expect(listDirectories(join(root, "b/nope/deeper")).path).toBe(join(root, "b"));
    expect(listDirectories(join(root, "file.txt")).path).toBe(root);
  });

  it("stops at the top of the disk", () => {
    expect(listDirectories("/").parent).toBeNull();
  });

  it("stays inside a root, and gives the path relative to it", () => {
    expect(listDirectories("", root)).toMatchObject({ path: root, value: "", parent: null });
    expect(listDirectories("b/inner", root)).toMatchObject({ value: "b/inner", parent: join(root, "b") });
    expect(listDirectories("../..", root).path).toBe(root);
    expect(listDirectories("/etc", root).path).toBe(root);
  });

  it("reports a folder it cannot read", () => {
    chmodSync(join(root, "a"), 0o000);
    expect(listDirectories(join(root, "a"))).toMatchObject({ readable: false, entries: [] });
    chmodSync(join(root, "a"), 0o755);
  });
});
