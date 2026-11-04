import { beforeEach, describe, expect, it } from "vitest";
import {
  addTag,
  deleteTag,
  exportClassification,
  importClassification,
  removeTag,
  renameTag,
  setAbandoned,
  setFavorite,
  setNote,
  setStatus,
} from "./classification";
import { type Db, openDb } from "./db/client";
import { projectFacts, projectMeta, projects, projectTags, tags } from "./db/schema";

let db: Db;
let a: number;
let b: number;

const tagNames = () => db.select().from(tags).all().map((tag) => tag.name).sort();

beforeEach(() => {
  db = openDb(":memory:");
  a = db.insert(projects).values({ path: "/p/a", name: "a" }).returning().get().id;
  b = db.insert(projects).values({ path: "/p/b", name: "b" }).returning().get().id;
});

describe("meta", () => {
  it("changes one field without losing the others", () => {
    setNote(db, a, "reprendre");
    setStatus(db, [a, b], "paused");
    setFavorite(db, a, true);
    expect(db.select().from(projectMeta).all().map((m) => [m.status, m.favorite, m.note])).toEqual([
      ["paused", true, "reprendre"],
      ["paused", false, null],
    ]);
    setStatus(db, [a], null);
    setNote(db, a, "");
    const meta = db.select().from(projectMeta).all()[0];
    expect([meta.status, meta.note, meta.favorite]).toEqual([null, null, true]);
  });
});

describe("abandoned", () => {
  it("flags several projects and forgets their running containers", () => {
    const container = { name: "c", service: "c", state: "running", status: "Up", ports: "" };
    db.insert(projectFacts).values({ projectId: a, containers: [container] }).run();
    setAbandoned(db, [a, b], true);
    expect(db.select().from(projects).all().map((p) => p.abandoned)).toEqual([true, true]);
    expect(db.select().from(projectFacts).get()?.containers).toEqual([]);
    setAbandoned(db, [b], false);
    expect(db.select().from(projects).all().map((p) => p.abandoned)).toEqual([true, false]);
  });

  it("tolerates an empty selection", () => {
    setAbandoned(db, [], true);
    expect(db.select().from(projects).all().map((p) => p.abandoned)).toEqual([false, false]);
  });
});

describe("tags", () => {
  it("cleans names, refuses empty ones and ignores case when reusing", () => {
    addTag(db, [a], "  Adimeo   Client ");
    addTag(db, [b], "adimeo client");
    addTag(db, [a], "   ");
    addTag(db, [a], "x".repeat(81));
    expect(tagNames()).toEqual(["Adimeo Client"]);
    expect(db.select().from(projectTags).all()).toHaveLength(2);
  });

  it("adds twice without error, removes from several projects and keeps the unused tag", () => {
    addTag(db, [a, b], "php");
    addTag(db, [a], "php");
    removeTag(db, [a], "php");
    expect(db.select().from(projectTags).all().map((item) => item.projectId)).toEqual([b]);
    removeTag(db, [b], "php");
    expect(db.select().from(projectTags).all()).toEqual([]);
    expect(tagNames()).toEqual(["php"]);
  });

  it("renames, allows a case change and refuses a taken name", () => {
    addTag(db, [a], "perso");
    addTag(db, [a], "client");
    expect(renameTag(db, "perso", "Perso")).toBeNull();
    expect(renameTag(db, "Perso", "CLIENT")).toContain("existe déjà");
    expect(renameTag(db, "Perso", "  ")).toContain("pas valide");
    expect(renameTag(db, "absent", "x")).toContain("n'existe plus");
    expect(tagNames()).toEqual(["client", "Perso"].sort());
  });

  it("deletes a tag and keeps its projects and meta", () => {
    addTag(db, [a], "perso");
    setStatus(db, [a], "active");
    deleteTag(db, "perso");
    expect(db.select().from(projectTags).all()).toEqual([]);
    expect(db.select().from(projects).all()).toHaveLength(2);
    expect(db.select().from(projectMeta).get()?.status).toBe("active");
  });
});

describe("export and import", () => {
  function classify() {
    setStatus(db, [a], "active");
    setFavorite(db, a, true);
    setNote(db, a, "note");
    addTag(db, [a], "php");
    setAbandoned(db, [b], true);
  }

  const exportedA = { path: "/p/a", status: "active", favorite: true, note: "note", abandoned: false, tags: ["php"] };
  const exportedB = { path: "/p/b", status: null, favorite: false, note: null, abandoned: true, tags: [] };

  it("exports only what the user decided, including abandoned projects", () => {
    db.insert(projects).values({ path: "/p/untouched", name: "untouched" }).run();
    classify();
    expect(exportClassification(db)).toEqual({ version: 2, projects: [exportedA, exportedB] });
  });

  it("restores everything into an empty database and reports unknown paths", () => {
    classify();
    const json = JSON.stringify(exportClassification(db));

    const target = openDb(":memory:");
    target.insert(projects).values({ path: "/p/a", name: "a" }).run();
    target.insert(projects).values({ path: "/p/b", name: "b" }).run();
    expect(importClassification(target, json)).toEqual({ imported: 2, unknownPaths: [] });
    expect(exportClassification(target)).toEqual(JSON.parse(json));

    expect(importClassification(openDb(":memory:"), json)).toEqual({
      imported: 0,
      unknownPaths: ["/p/a", "/p/b"],
    });
  });

  it("converts an export made while collections existed", () => {
    const old = {
      version: 1,
      collections: ["Abandonnés", "Perso"],
      projects: [
        { path: "/p/a", status: null, favorite: false, note: null, collections: ["Abandonnés", "Perso"], tags: ["php"] },
      ],
    };
    expect(importClassification(db, JSON.stringify(old))).toEqual({ imported: 1, unknownPaths: [] });
    expect(exportClassification(db).projects).toEqual([
      { path: "/p/a", status: null, favorite: false, note: null, abandoned: true, tags: ["Perso", "php"] },
    ]);
  });

  it("imports the former archived status as no status", () => {
    const old = {
      version: 2,
      projects: [{ path: "/p/a", status: "archived", favorite: false, note: "garder", abandoned: false, tags: [] }],
    };
    expect(importClassification(db, JSON.stringify(old))).toEqual({ imported: 1, unknownPaths: [] });
    expect(db.select().from(projectMeta).get()).toMatchObject({ status: null, note: "garder" });
  });

  it("replaces listed projects and leaves the others alone", () => {
    classify();
    const result = importClassification(
      db,
      JSON.stringify({
        version: 2,
        projects: [{ path: "/p/a", status: null, favorite: false, note: null, abandoned: false, tags: ["neuf"] }],
      }),
    );
    expect(result).toEqual({ imported: 1, unknownPaths: [] });
    const exported = exportClassification(db).projects;
    expect(exported.find((p) => p.path === "/p/a")?.tags).toEqual(["neuf"]);
    expect(exported.find((p) => p.path === "/p/b")?.abandoned).toBe(true);
  });

  it.each([
    ["pas du json", "n'est pas du JSON"],
    ["{}", "n'est pas un export"],
    ['{"version":3,"projects":[]}', "n'est pas un export"],
    ['{"version":2,"projects":[{"path":"/p/a","status":"x","favorite":false,"note":null,"abandoned":false,"tags":[]}]}', "n'est pas un export"],
    ['{"version":2,"projects":[{"path":"/p/a","status":null,"favorite":false,"note":null,"tags":[]}]}', "n'est pas un export"],
    ['{"version":1,"projects":[{"path":"/p/a","status":null,"favorite":false,"note":null,"tags":[]}]}', "n'est pas un export"],
  ])("refuses %s without changing anything", (json, message) => {
    classify();
    const before = exportClassification(db);
    const result = importClassification(db, json);
    expect("error" in result && result.error).toContain(message);
    expect(exportClassification(db)).toEqual(before);
  });
});
