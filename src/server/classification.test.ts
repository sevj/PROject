import { beforeEach, describe, expect, it } from "vitest";
import {
  addTag,
  createCollection,
  exportClassification,
  importClassification,
  removeTag,
  setCollectionMembership,
  setFavorite,
  setNote,
  setStatus,
} from "./classification";
import { type Db, openDb } from "./db/client";
import { collections, projectCollections, projectMeta, projects, tags } from "./db/schema";

let db: Db;
let a: number;
let b: number;

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

describe("collections", () => {
  it("cleans names, reuses an existing one and refuses an empty one", () => {
    const first = createCollection(db, "  Clients   Adimeo ");
    expect(first?.name).toBe("Clients Adimeo");
    expect(createCollection(db, "Clients Adimeo")?.id).toBe(first?.id);
    expect(createCollection(db, "   ")).toBeNull();
    expect(createCollection(db, "x".repeat(81))).toBeNull();
    expect(db.select().from(collections).all()).toHaveLength(1);
  });

  it("adds several projects, tolerates duplicates and removes only the requested ones", () => {
    const id = createCollection(db, "Perso")?.id ?? 0;
    setCollectionMembership(db, [a, b], id, true);
    setCollectionMembership(db, [a], id, true);
    expect(db.select().from(projectCollections).all()).toHaveLength(2);
    setCollectionMembership(db, [a], id, false);
    expect(db.select().from(projectCollections).all().map((m) => m.projectId)).toEqual([b]);
  });
});

describe("tags", () => {
  it("removes a tag from the list once nobody uses it", () => {
    addTag(db, [a, b], " php ");
    removeTag(db, a, "php");
    expect(db.select().from(tags).all()).toHaveLength(1);
    removeTag(db, b, "php");
    expect(db.select().from(tags).all()).toHaveLength(0);
  });
});

describe("export and import", () => {
  function classify() {
    const id = createCollection(db, "Perso")?.id ?? 0;
    createCollection(db, "Vide");
    setCollectionMembership(db, [a], id, true);
    setStatus(db, [a], "active");
    setFavorite(db, a, true);
    setNote(db, a, "note");
    addTag(db, [a], "php");
  }

  it("exports only what the user decided", () => {
    classify();
    expect(exportClassification(db)).toEqual({
      version: 1,
      collections: ["Perso", "Vide"],
      projects: [
        { path: "/p/a", status: "active", favorite: true, note: "note", collections: ["Perso"], tags: ["php"] },
      ],
    });
  });

  it("restores everything into an empty database and reports unknown paths", () => {
    classify();
    const json = JSON.stringify(exportClassification(db));

    const target = openDb(":memory:");
    target.insert(projects).values({ path: "/p/a", name: "a" }).run();
    expect(importClassification(target, json)).toEqual({ imported: 1, unknownPaths: [] });
    expect(exportClassification(target)).toEqual(JSON.parse(json));

    const other = openDb(":memory:");
    expect(importClassification(other, json)).toEqual({ imported: 0, unknownPaths: ["/p/a"] });
    expect(other.select().from(collections).all()).toHaveLength(2);
  });

  it("replaces listed projects and leaves the others alone", () => {
    classify();
    setStatus(db, [b], "paused");
    const result = importClassification(
      db,
      JSON.stringify({
        version: 1,
        collections: [],
        projects: [{ path: "/p/a", status: null, favorite: false, note: null, collections: ["Neuve"], tags: [] }],
      }),
    );
    expect(result).toEqual({ imported: 1, unknownPaths: [] });
    const exported = exportClassification(db);
    expect(exported.projects.find((p) => p.path === "/p/a")).toEqual({
      path: "/p/a",
      status: null,
      favorite: false,
      note: null,
      collections: ["Neuve"],
      tags: [],
    });
    expect(exported.projects.find((p) => p.path === "/p/b")?.status).toBe("paused");
  });

  it.each([
    ["pas du json", "n'est pas du JSON"],
    ["{}", "n'est pas un export"],
    ['{"version":2,"collections":[],"projects":[]}', "n'est pas un export"],
    ['{"version":1,"collections":[1],"projects":[]}', "n'est pas un export"],
    ['{"version":1,"collections":[],"projects":[{"path":"/p/a","status":"x","favorite":false,"note":null,"collections":[],"tags":[]}]}', "n'est pas un export"],
  ])("refuses %s without changing anything", (json, message) => {
    classify();
    const before = exportClassification(db);
    const result = importClassification(db, json);
    expect("error" in result && result.error).toContain(message);
    expect(exportClassification(db)).toEqual(before);
  });
});
