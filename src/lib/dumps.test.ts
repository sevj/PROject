import { describe, expect, it } from "vitest";
import { formatDuration, progressOf } from "./dumps";

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
