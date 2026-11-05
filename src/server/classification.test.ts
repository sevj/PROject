import { beforeEach, describe, expect, it } from "vitest";
import {
  addTag,
  deleteTag,
  getFetchRemote,
  removeTag,
  renameTag,
  setAbandoned,
  setDescription,
  setDisplayName,
  setFavorite,
  setFetchRemote,
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

describe("fetch remote", () => {
  it("reads all remotes until one is chosen, and again once it is unset", () => {
    expect(getFetchRemote(db, a)).toBeNull();
    setFetchRemote(db, a, "origin");
    expect(getFetchRemote(db, a)).toBe("origin");
    setFetchRemote(db, a, null);
    expect(getFetchRemote(db, a)).toBeNull();
  });

  it("leaves the rest of what is known of the project alone", () => {
    setNote(db, a, "kept");
    setFetchRemote(db, a, "origin");
    expect(db.select().from(projectMeta).get()).toMatchObject({ note: "kept", fetchRemote: "origin" });
  });
});

describe("display name", () => {
  const stored = () => db.select().from(projectMeta).get()?.displayName;

  it("cleans the name, and goes back to the folder when empty or identical", () => {
    setDisplayName(db, a, "  Mon   projet ");
    expect(stored()).toBe("Mon projet");
    setDisplayName(db, a, "   ");
    expect(stored()).toBeNull();
    setDisplayName(db, a, "Autre");
    setDisplayName(db, a, "a");
    expect(stored()).toBeNull();
  });

  it("ignores an unknown project", () => {
    setDisplayName(db, 9999, "x");
    expect(db.select().from(projectMeta).all()).toEqual([]);
  });
});

describe("description", () => {
  it("trims and limits the text, and clears it when empty", () => {
    const stored = () => db.select().from(projectMeta).get()?.description;
    setDescription(db, a, "  Une appli\nde test ");
    expect(stored()).toBe("Une appli\nde test");
    setDescription(db, a, "x".repeat(600));
    expect(stored()).toHaveLength(500);
    setDescription(db, a, "   ");
    expect(stored()).toBeNull();
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
    expect(renameTag(db, "Perso", "CLIENT")).toContain("already exists");
    expect(renameTag(db, "Perso", "  ")).toContain("not valid");
    expect(renameTag(db, "absent", "x")).toContain("no longer exists");
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
