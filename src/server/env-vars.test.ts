import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "./db/client";
import { projects } from "./db/schema";
import { readEnvView, restoreEnvValue, saveEnvValue } from "./env-vars";

let dir: string;
let db: Db;
let projectId: number;

const local = () => readFileSync(join(dir, ".env.local"), "utf8");
const writeLocal = (content: string) => writeFileSync(join(dir, ".env.local"), content);
const view = () => readEnvView(db, projectId, dir, false);
const history = async (key: string) => ((await view()).history[key] ?? []).map(({ value, origin }) => [value, origin]);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-env-"));
  db = openDb(":memory:");
  projectId = db.insert(projects).values({ path: dir, name: "p" }).returning().get().id;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readEnvView", () => {
  it("shows what the local file lacks compared to the declarations", async () => {
    writeFileSync(join(dir, ".env"), "A=1\nB=2\n");
    writeLocal("A=9\n");
    const { rows, declaredExists, localExists } = await view();
    expect(rows.map(({ key, state }) => [key, state])).toEqual([
      ["A", "different"],
      ["B", "missing"],
    ]);
    expect([declaredExists, localExists]).toEqual([true, true]);
  });

  it("says when the files are not there", async () => {
    const { rows, declaredExists, localExists, localUnreadable } = await view();
    expect(rows).toEqual([]);
    expect([declaredExists, localExists, localUnreadable]).toEqual([false, false, false]);
  });

  it("does not follow a link", async () => {
    writeFileSync(join(dir, "elsewhere"), "SECRET=1\n");
    symlinkSync(join(dir, "elsewhere"), join(dir, ".env.local"));
    const { rows, localUnreadable } = await view();
    expect(rows).toEqual([]);
    expect(localUnreadable).toBe(true);
  });
});

describe("saveEnvValue", () => {
  it("creates the local file and leaves the declarations alone", () => {
    writeFileSync(join(dir, ".env"), "A=1\n");
    expect(saveEnvValue(db, projectId, dir, "A", "2")).toBeNull();
    expect(local()).toBe("A=2\n");
    expect(readFileSync(join(dir, ".env"), "utf8")).toBe("A=1\n");
  });

  it("keeps the value it overwrites when it was never saved from here", async () => {
    writeLocal("A=by-hand\n");
    saveEnvValue(db, projectId, dir, "A", "first");
    saveEnvValue(db, projectId, dir, "A", "second");
    expect(await history("A")).toEqual([
      ["second", "edit"],
      ["first", "edit"],
      ["by-hand", "file"],
    ]);
  });

  it("also catches a change made by hand between two saves", async () => {
    saveEnvValue(db, projectId, dir, "A", "first");
    writeLocal("A=by-hand\n");
    saveEnvValue(db, projectId, dir, "A", "second");
    expect(await history("A")).toEqual([
      ["second", "edit"],
      ["by-hand", "file"],
      ["first", "edit"],
    ]);
  });

  it("records nothing when the value does not change", async () => {
    writeLocal("A=same\n");
    expect(saveEnvValue(db, projectId, dir, "A", "same")).toBeNull();
    expect(await history("A")).toEqual([]);
  });

  it("removes a variable, which stays in the history", async () => {
    writeLocal("A=1\nB=2\n");
    expect(saveEnvValue(db, projectId, dir, "A", null)).toBeNull();
    expect(local()).toBe("B=2\n");
    expect(await history("A")).toEqual([
      [null, "edit"],
      ["1", "file"],
    ]);
    expect((await view()).rows.find(({ key }) => key === "A")?.state).toBe("removed");
  });

  it("refuses a name or a value that does not belong in the file", () => {
    writeLocal("A=1\n");
    for (const key of ["", "1A", "A B", "A=1", "A\nB", "../A"]) {
      expect(saveEnvValue(db, projectId, dir, key, "x")).toContain("not a valid");
    }
    expect(saveEnvValue(db, projectId, dir, "A", "a\0b")).toContain("cannot be stored");
    expect(local()).toBe("A=1\n");
  });

  it("refuses to write through a link", () => {
    writeFileSync(join(dir, "elsewhere"), "A=1\n");
    symlinkSync(join(dir, "elsewhere"), join(dir, ".env.local"));
    expect(saveEnvValue(db, projectId, dir, "A", "2")).toContain("could not be read");
    expect(readFileSync(join(dir, "elsewhere"), "utf8")).toBe("A=1\n");
  });

  it("keeps the permissions of the file and leaves nothing behind", () => {
    writeLocal("A=1\n");
    chmodSync(join(dir, ".env.local"), 0o640);
    saveEnvValue(db, projectId, dir, "A", "2");
    expect(statSync(join(dir, ".env.local")).mode & 0o777).toBe(0o640);
    expect(readdirSync(dir)).toEqual([".env.local"]);
  });

  it("changes neither the file nor the history when it cannot write", async () => {
    writeLocal("A=1\n");
    chmodSync(join(dir, ".env.local"), 0o440);
    expect(saveEnvValue(db, projectId, dir, "A", "2")).toContain("could not be written");
    expect(local()).toBe("A=1\n");
    expect(await history("A")).toEqual([]);
    chmodSync(join(dir, ".env.local"), 0o640);
  });

  it("forgets everything with its project", async () => {
    saveEnvValue(db, projectId, dir, "A", "1");
    db.delete(projects).run();
    expect((await view()).history).toEqual({});
  });
});

describe("restoreEnvValue", () => {
  it("brings back an earlier value, and records that it did", async () => {
    saveEnvValue(db, projectId, dir, "A", "first");
    saveEnvValue(db, projectId, dir, "A", "second");
    const first = (await view()).history.A.find(({ value }) => value === "first");
    expect(restoreEnvValue(db, projectId, dir, first?.id ?? 0)).toBeNull();
    expect(local()).toBe("A=first\n");
    expect(await history("A")).toEqual([
      ["first", "restore"],
      ["second", "edit"],
      ["first", "edit"],
    ]);
  });

  it("brings back the absence of a variable", async () => {
    writeLocal("A=1\n");
    saveEnvValue(db, projectId, dir, "A", null);
    saveEnvValue(db, projectId, dir, "A", "2");
    const removal = (await view()).history.A.find(({ value }) => value === null);
    expect(restoreEnvValue(db, projectId, dir, removal?.id ?? 0)).toBeNull();
    expect(local()).toBe("");
  });

  it("refuses an entry of another project", async () => {
    saveEnvValue(db, projectId, dir, "A", "1");
    const entry = (await view()).history.A[0];
    const other = db.insert(projects).values({ path: `${dir}-other`, name: "o" }).returning().get().id;
    expect(restoreEnvValue(db, other, dir, entry.id)).toContain("no longer");
    expect(existsSync(join(dir, ".env.local"))).toBe(true);
  });
});
