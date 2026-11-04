import { describe, expect, it } from "vitest";
import { type DumpRow, endedSince, formatDuration, groupByProject, overallPercent, progressOf } from "./dumps";

const base = { status: "running" as const, processedBytes: 0, totalBytes: 1000, startedAt: 0, finishedAt: null };

describe("progressOf", () => {
  it("gives the share done, the speed since the start, and how long is left", () => {
    expect(progressOf({ ...base, processedBytes: 250 }, 5000)).toEqual({ percent: 25, rate: 50, elapsedMs: 5000, remainingMs: 15_000 });
  });

  it("does not reach 100 until it is over", () => {
    expect(progressOf({ ...base, processedBytes: 1000 }, 2000).percent).toBe(99);
    expect(progressOf({ ...base, processedBytes: 1000, status: "done", finishedAt: 2000 }, 9000)).toMatchObject({ percent: 100, remainingMs: null });
  });

  it("stops the clock when it is over", () => {
    expect(progressOf({ ...base, processedBytes: 500, status: "failed", finishedAt: 1000 }, 99_000)).toMatchObject({ elapsedMs: 1000, rate: 500 });
  });

  it("has no share when the total is unknown, and no time left", () => {
    expect(progressOf({ ...base, totalBytes: null, processedBytes: 300 }, 1000)).toMatchObject({ percent: null, remainingMs: null, rate: 300 });
    expect(progressOf({ ...base, totalBytes: 0 }, 1000).percent).toBeNull();
    expect(progressOf({ ...base, totalBytes: null, status: "done", finishedAt: 10 }, 20).percent).toBe(100);
  });

  it("copes with a start that has not been measured yet", () => {
    expect(progressOf(base, 0)).toMatchObject({ percent: 0, rate: 0, remainingMs: null });
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0 s"],
    [4400, "4 s"],
    [59_400, "59 s"],
    [59_600, "1 min 00 s"],
    [61_000, "1 min 01 s"],
    [3_725_000, "1 h 02 min"],
  ])("writes %d ms as %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe("endedSince", () => {
  const job = (id: string, status: string) => ({ id, status });

  it("returns the jobs that were running and no longer are", () => {
    const before = new Map([["a", "running"], ["b", "running"], ["c", "done"]]);
    expect(endedSince(before, [job("a", "done"), job("b", "running"), job("c", "done"), job("d", "failed")])).toEqual([job("a", "done")]);
  });

  it("does not announce a job it saw for the first time already over", () => {
    expect(endedSince(new Map(), [job("a", "failed")])).toEqual([]);
  });
});

describe("overallPercent", () => {
  it("counts only the running jobs whose total is known", () => {
    expect(
      overallPercent([
        { status: "running", processedBytes: 50, totalBytes: 100 },
        { status: "running", processedBytes: 150, totalBytes: 300 },
        { status: "running", processedBytes: 10, totalBytes: null },
        { status: "done", processedBytes: 900, totalBytes: 900 },
      ]),
    ).toBe(50);
  });

  it("has none when nothing can be measured, and never says 100", () => {
    expect(overallPercent([{ status: "running", processedBytes: 5, totalBytes: null }])).toBeNull();
    expect(overallPercent([{ status: "running", processedBytes: 500, totalBytes: 100 }])).toBe(99);
  });
});

describe("groupByProject", () => {
  const dump = (id: number, projectId: number | null, projectName: string, createdAt: number, sizeBytes: number | null, status: DumpRow["status"] = "done"): DumpRow => ({
    id, projectId, projectName, containerName: "db", engine: "postgres", database: "app", fileName: `${id}.sql.gz`, sizeBytes, rawBytes: sizeBytes, status, error: null, note: null, createdAt,
  });

  it("groups by project, the latest first, and adds up the sizes of the finished dumps", () => {
    const groups = groupByProject([dump(1, 1, "Alpha", 100, 10), dump(2, 2, "Beta", 300, 5), dump(3, 1, "Alpha", 200, 20), dump(4, 1, "Alpha", 400, 99, "failed")]);
    expect(groups.map((group) => [group.projectName, group.dumps.map((item) => item.id), group.totalBytes])).toEqual([
      ["Alpha", [1, 3, 4], 30],
      ["Beta", [2], 5],
    ]);
  });

  it("gives a place to the projects that have a database but no dump yet, after the others", () => {
    const groups = groupByProject([dump(1, 1, "Alpha", 100, 10)], [{ id: 1, name: "Alpha" }, { id: 7, name: "Zed" }]);
    expect(groups.map((group) => [group.projectName, group.dumps.length])).toEqual([["Alpha", 1], ["Zed", 0]]);
  });

  it("keeps the dumps of removed projects together by name", () => {
    const groups = groupByProject([dump(1, null, "Gone", 1, 1), dump(2, null, "Gone", 2, 1), dump(3, null, "Other", 3, 1)]);
    expect(groups.map((group) => [group.projectName, group.projectId, group.dumps.length])).toEqual([["Other", null, 1], ["Gone", null, 2]]);
  });
});
