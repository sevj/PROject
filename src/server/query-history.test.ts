import { describe, expect, it } from "vitest";
import { openDb } from "./db/client";
import { projects } from "./db/schema";
import { clearHistory, countHistory, HISTORY_LIMIT, listHistory, recordQuery } from "./query-history";

const entry = (statement: string, projectId = 1) => ({
  projectId,
  containerName: "db",
  database: "shop",
  statement,
  ok: true,
  rowCount: 3,
  elapsedMs: 12,
});

describe("query history", () => {
  const setup = () => {
    const db = openDb(":memory:");
    db.insert(projects).values([{ path: "/a", name: "a" }, { path: "/b", name: "b" }]).run();
    return db;
  };

  it("lists the newest first, per project", () => {
    const db = setup();
    recordQuery(db, entry("SELECT 1"), new Date(1000));
    recordQuery(db, entry("SELECT 2"), new Date(2000));
    recordQuery(db, entry("SELECT 3", 2), new Date(3000));
    expect(listHistory(db, 1).map(({ statement }) => statement)).toEqual(["SELECT 2", "SELECT 1"]);
    expect(listHistory(db, 2)).toHaveLength(1);
  });

  it("keeps only the latest ones", () => {
    const db = setup();
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) recordQuery(db, entry(`SELECT ${i}`), new Date(i * 1000));
    expect(countHistory(db, 1)).toBe(HISTORY_LIMIT);
    expect(listHistory(db, 1, 1)[0].statement).toBe(`SELECT ${HISTORY_LIMIT + 4}`);
  });

  it("clears one project's history only", () => {
    const db = setup();
    recordQuery(db, entry("SELECT 1"));
    recordQuery(db, entry("SELECT 2", 2));
    clearHistory(db, 1);
    expect(countHistory(db, 1)).toBe(0);
    expect(countHistory(db, 2)).toBe(1);
  });
});
