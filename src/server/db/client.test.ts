import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDb } from "./client";
import { projectFacts, projectMeta, projects } from "./schema";

describe("openDb", () => {
  it("applies the migrations and enforces foreign keys", () => {
    const db = openDb(":memory:");
    expect(() => db.insert(projectMeta).values({ projectId: 999 }).run()).toThrow();
  });

  it("keeps user data when facts are replaced, and removes both with the project", () => {
    const db = openDb(":memory:");
    const { id } = db.insert(projects).values({ path: "/p/a", name: "a" }).returning().get();
    db.insert(projectMeta).values({ projectId: id, note: "reprendre ici", status: "paused" }).run();
    db.insert(projectFacts).values({ projectId: id, stacks: ["php"] }).run();

    db.delete(projectFacts).where(eq(projectFacts.projectId, id)).run();
    db.insert(projectFacts).values({ projectId: id, stacks: ["node"] }).run();

    expect(db.select().from(projectMeta).get()?.note).toBe("reprendre ici");
    expect(db.select().from(projectFacts).get()?.stacks).toEqual(["node"]);

    db.delete(projects).where(eq(projects.id, id)).run();
    expect(db.select().from(projectMeta).all()).toEqual([]);
    expect(db.select().from(projectFacts).all()).toEqual([]);
  });
});
