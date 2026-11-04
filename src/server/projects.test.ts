import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addTag, setAbandoned } from "./classification";
import { type Db, openDb } from "./db/client";
import { projectFacts, projectMeta, projects, projectTags, settings } from "./db/schema";
import {
  changeDirectory,
  registerMultiProject,
  registerProject,
  registerSubProject,
  removeProjects,
} from "./projects";
import { getRegistry } from "./registry";
import { getSettings, saveSettings } from "./settings";

let root: string;
let db: Db;

const dir = (relative: string) => {
  const path = join(root, relative);
  mkdirSync(path, { recursive: true });
  return path;
};
const ids = (result: { ids: number[] } | { error: string }) => {
  if ("error" in result) throw new Error(result.error);
  return result.ids;
};
const paths = () => db.select().from(projects).all().map(({ path }) => path).sort();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pm-projects-"));
  db = openDb(":memory:");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("registerProject", () => {
  it("stores the name, the description and the folder", () => {
    const [id] = ids(registerProject(db, { name: " Mon  appli ", description: " Un site ", directory: `${dir("app")}/` }));
    expect(db.select().from(projects).where(eq(projects.id, id)).get()).toMatchObject({
      path: join(root, "app"),
      name: "app",
      kind: "project",
      parentId: null,
    });
    expect(db.select().from(projectMeta).get()).toMatchObject({ displayName: "Mon appli", description: "Un site" });
    expect(db.select().from(projectFacts).get()?.projectId).toBe(id);
  });

  it("appears in the registry straight away", () => {
    ids(registerProject(db, { name: "Appli", description: "", directory: dir("app") }));
    expect(getRegistry(db).rows.map((row) => row.name)).toEqual(["Appli"]);
  });

  it("understands ~ as the home folder", () => {
    // The home folder exists on every machine running these tests.
    const [id] = ids(registerProject(db, { name: "Maison", description: "", directory: "~" }));
    expect(db.select().from(projects).where(eq(projects.id, id)).get()?.path).toBe(homedir());
  });

  it.each([
    ["an empty name", { name: "  ", description: "", directory: "/" }, "name"],
    ["an empty directory", { name: "a", description: "", directory: " " }, "required"],
    ["a relative directory", { name: "a", description: "", directory: "Projects/a" }, "full path"],
    ["an unknown directory", { name: "a", description: "", directory: "/nulle/part" }, "does not exist"],
  ])("refuses %s", (_, input, message) => {
    const result = registerProject(db, input);
    expect("error" in result && result.error).toContain(message);
    expect(paths()).toEqual([]);
  });

  it("refuses a file, and a folder already listed", () => {
    writeFileSync(join(root, "file"), "");
    expect(registerProject(db, { name: "a", description: "", directory: join(root, "file") })).toHaveProperty("error");
    ids(registerProject(db, { name: "a", description: "", directory: dir("app") }));
    const again = registerProject(db, { name: "b", description: "", directory: dir("app") });
    expect("error" in again && again.error).toContain("already");
  });
});

describe("language", () => {
  it("speaks English by default, and the chosen language once set", () => {
    const refused = (result: ReturnType<typeof registerProject>) => ("error" in result ? result.error : null);
    const input = { name: "a", description: "", directory: "/nulle/part" };
    expect(refused(registerProject(db, input))).toBe("The directory /nulle/part does not exist.");
    saveSettings(db, { locale: "fr" });
    expect(refused(registerProject(db, input))).toBe("Le répertoire /nulle/part n'existe pas.");
  });

  it("falls back to English when the stored language no longer exists", () => {
    db.insert(settings).values({ id: 1, value: { locale: "xx", ideCommands: {}, terminalCommand: "t" } }).run();
    expect(getSettings(db).locale).toBe("en");
  });
});

describe("registerMultiProject", () => {
  const input = () => ({ name: "Suite", description: "Le tout", directory: dir("suite") });
  const repo = (name: string, subdirectory: string) => ({ name, description: `Dépôt ${name}`, subdirectory });

  it("stores the parent and one project per repository", () => {
    dir("suite/front");
    dir("suite/libs/core");
    const [groupId, front, core] = ids(
      registerMultiProject(db, input(), [repo("Front", "front"), repo("Coeur", "./libs/core/")]),
    );
    const byId = (id: number) => db.select().from(projects).where(eq(projects.id, id)).get();
    expect(byId(groupId)).toMatchObject({ kind: "group", path: join(root, "suite") });
    expect(byId(front)).toMatchObject({ kind: "project", parentId: groupId, path: join(root, "suite/front") });
    expect(byId(core)).toMatchObject({ parentId: groupId, path: join(root, "suite/libs/core") });

    const rows = getRegistry(db).rows;
    expect(rows.map((row) => [row.name, row.subdirectory, row.parentName, row.parentDescription, row.description])).toEqual([
      ["Front", "front", "Suite", "Le tout", "Dépôt Front"],
      ["Coeur", "libs/core", "Suite", "Le tout", "Dépôt Coeur"],
    ]);
  });

  it("adds nothing at all when one repository is wrong", () => {
    dir("suite/front");
    const result = registerMultiProject(db, input(), [repo("Front", "front"), repo("Absent", "absent")]);
    expect("error" in result && result.error).toContain("Repository 2");
    expect(paths()).toEqual([]);
  });

  it("refuses no repository, a duplicate, and a folder outside the parent", () => {
    dir("suite/front");
    dir("ailleurs");
    expect(registerMultiProject(db, input(), [])).toHaveProperty("error");
    expect(registerMultiProject(db, input(), [repo("A", "front"), repo("B", "front/")])).toHaveProperty("error");
    expect(registerMultiProject(db, input(), [repo("A", "../ailleurs")])).toHaveProperty("error");
    expect(registerMultiProject(db, input(), [repo("A", ".")])).toHaveProperty("error");
    expect(registerMultiProject(db, input(), [repo("A", join(root, "ailleurs"))])).toHaveProperty("error");
    expect(paths()).toEqual([]);
  });

  it("accepts a full path inside the parent", () => {
    const front = dir("suite/front");
    ids(registerMultiProject(db, input(), [repo("A", front)]));
    expect(paths()).toContain(front);
  });
});

describe("registerSubProject", () => {
  it("adds a repository to a multi-project, and only to one", () => {
    dir("suite/front");
    const back = dir("suite/back");
    const [groupId, front] = ids(
      registerMultiProject(db, { name: "Suite", description: "", directory: dir("suite") }, [
        { name: "Front", description: "", subdirectory: "front" },
      ]),
    );
    const [id] = ids(registerSubProject(db, groupId, { name: "Back", description: "", subdirectory: "back" }));
    expect(db.select().from(projects).where(eq(projects.id, id)).get()).toMatchObject({ parentId: groupId, path: back });

    const refused = registerSubProject(db, front, { name: "x", description: "", subdirectory: "x" });
    expect("error" in refused && refused.error).toContain("no longer exists");
    const twice = registerSubProject(db, groupId, { name: "Back", description: "", subdirectory: "back" });
    expect("error" in twice && twice.error).toContain("already");
  });
});

describe("changeDirectory", () => {
  it("follows a moved project, keeping its name and flagging nothing", () => {
    const [id] = ids(registerProject(db, { name: "Appli", description: "", directory: dir("old") }));
    db.update(projects).set({ missingAt: new Date() }).where(eq(projects.id, id)).run();
    expect(ids(changeDirectory(db, id, dir("new")))).toEqual([id]);
    expect(db.select().from(projects).get()).toMatchObject({ path: join(root, "new"), name: "new" });
    expect(db.select().from(projectMeta).get()?.displayName).toBe("Appli");
  });

  it("takes the sub-projects along with a multi-project", () => {
    dir("old/front");
    const [groupId, front] = ids(
      registerMultiProject(db, { name: "Suite", description: "", directory: dir("old") }, [
        { name: "Front", description: "", subdirectory: "front" },
      ]),
    );
    expect(ids(changeDirectory(db, groupId, dir("new")))).toEqual([groupId, front]);
    expect(paths()).toEqual([join(root, "new"), join(root, "new/front")]);
  });

  it("reads a sub-project's folder relative to its parent", () => {
    dir("suite/front");
    const moved = dir("suite/web");
    const [, front] = ids(
      registerMultiProject(db, { name: "Suite", description: "", directory: dir("suite") }, [
        { name: "Front", description: "", subdirectory: "front" },
      ]),
    );
    ids(changeDirectory(db, front, "web"));
    expect(paths()).toContain(moved);
    expect(changeDirectory(db, front, "../ailleurs")).toHaveProperty("error");
  });

  it("refuses a folder already listed, but accepts its own", () => {
    const a = dir("a");
    const [id] = ids(registerProject(db, { name: "A", description: "", directory: a }));
    ids(registerProject(db, { name: "B", description: "", directory: dir("b") }));
    expect(changeDirectory(db, id, join(root, "b"))).toHaveProperty("error");
    expect(ids(changeDirectory(db, id, a))).toEqual([id]);
    expect(changeDirectory(db, 9999, a)).toHaveProperty("error");
  });
});

describe("removeProjects", () => {
  it("takes a project off the list with its data, and leaves the disk alone", () => {
    const app = dir("app");
    writeFileSync(join(app, "file"), "");
    const [id] = ids(registerProject(db, { name: "Appli", description: "x", directory: app }));
    addTag(db, [id], "Client");
    removeProjects(db, [id]);
    expect(paths()).toEqual([]);
    expect(db.select().from(projectMeta).all()).toEqual([]);
    expect(db.select().from(projectFacts).all()).toEqual([]);
    expect(db.select().from(projectTags).all()).toEqual([]);
    expect(existsSync(join(app, "file"))).toBe(true);
    // It can be added again.
    ids(registerProject(db, { name: "Appli", description: "", directory: app }));
  });

  function suite() {
    dir("suite/front");
    dir("suite/back");
    return ids(
      registerMultiProject(db, { name: "Suite", description: "", directory: dir("suite") }, [
        { name: "Front", description: "", subdirectory: "front" },
        { name: "Back", description: "", subdirectory: "back" },
      ]),
    );
  }

  it("takes the sub-projects along with a multi-project", () => {
    const [groupId] = suite();
    removeProjects(db, [groupId]);
    expect(paths()).toEqual([]);
  });

  it("keeps a multi-project until its last repository goes", () => {
    const [groupId, front, back] = suite();
    removeProjects(db, [front]);
    expect(db.select().from(projects).where(eq(projects.id, groupId)).get()).toBeDefined();
    removeProjects(db, [back]);
    expect(paths()).toEqual([]);
  });

  it("counts an abandoned repository as still being there", () => {
    const [groupId, front, back] = suite();
    setAbandoned(db, [back], true);
    removeProjects(db, [front]);
    expect(db.select().from(projects).where(eq(projects.id, groupId)).get()).toBeDefined();
  });
});
