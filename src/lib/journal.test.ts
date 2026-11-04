import { describe, expect, it } from "vitest";
import { buildSessions, buildWeek, DEFAULT_JOURNAL, formatMinutes, mergeIntervals, minutesPerDay, normalizeJournal, startOfWeek } from "./journal";

const MIN = 60_000;
const at = (h: number, m = 0, day = 5) => new Date(2026, 10, day, h, m).getTime(); // Thursday 5 Nov 2026

describe("buildSessions", () => {
  it("groups moments closer than the gap and adds the padding before the first", () => {
    const sessions = buildSessions([at(10), at(10, 20), at(10, 45), at(14)], { gapMinutes: 30, paddingMinutes: 15 });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toEqual({ start: at(9, 45), end: at(10, 45), moments: 3 });
    expect(sessions[1]).toEqual({ start: at(13, 45), end: at(14), moments: 1 });
  });
  it("ignores order and duplicates", () => {
    expect(buildSessions([at(10, 20), at(10), at(10)], { gapMinutes: 30, paddingMinutes: 0 })).toEqual([{ start: at(10), end: at(10, 20), moments: 2 }]);
  });
  it("is empty without moments", () => {
    expect(buildSessions([], DEFAULT_JOURNAL)).toEqual([]);
  });
});

describe("mergeIntervals", () => {
  it("counts an overlap once", () => {
    expect(mergeIntervals([{ start: 0, end: 10 }, { start: 5, end: 20 }, { start: 30, end: 40 }])).toEqual([{ start: 0, end: 20 }, { start: 30, end: 40 }]);
  });
});

describe("weeks and days", () => {
  it("starts the week on Monday", () => {
    expect(startOfWeek(at(10))).toBe(new Date(2026, 10, 2).getTime());
    expect(startOfWeek(new Date(2026, 10, 8, 23).getTime())).toBe(new Date(2026, 10, 2).getTime());
  });
  it("splits a stretch across midnight", () => {
    const week = new Date(2026, 10, 2).getTime();
    const minutes = minutesPerDay([{ start: at(23, 0, 5), end: at(1, 0, 6) }], week);
    expect(minutes[3]).toBe(60);
    expect(minutes[4]).toBe(60);
  });
  it("is not fooled by a day of 23 or 25 hours", () => {
    // Europe/Paris changes clocks on 2026-10-25; the week of Monday 2026-10-19 holds it.
    const week = new Date(2026, 9, 19).getTime();
    const whole = [{ start: week, end: new Date(2026, 9, 26).getTime() }];
    const total = minutesPerDay(whole, week).reduce((a, b) => a + b, 0);
    expect(total).toBe(Math.round((whole[0].end - whole[0].start) / MIN));
  });
});

describe("buildWeek", () => {
  const week = new Date(2026, 10, 2).getTime();
  it("counts only the sources that are on, and overlapping projects once in the totals", () => {
    const result = buildWeek(week, { ...DEFAULT_JOURNAL, claude: false }, [
      { id: 1, name: "a", commits: [at(10), at(10, 10)], claude: [at(11)], files: [] },
      { id: 2, name: "b", commits: [at(10, 5)], claude: [], files: [] },
      { id: 3, name: "idle", commits: [], claude: [], files: [] },
    ]);
    expect(result.projects.map(({ name }) => name)).toEqual(["a", "b"]);
    const [a, b] = result.projects;
    expect(a.minutes[3]).toBe(25);
    expect(b.minutes[3]).toBe(15);
    // 09:45–10:10 and 09:50–10:05 overlap: 25 minutes, not 40.
    expect(result.totals[3]).toBe(25);
    expect(a.moments).toEqual({ commits: 2, claude: 0, files: 0 });
  });
  it("keeps a stretch that began before the week", () => {
    const result = buildWeek(week, DEFAULT_JOURNAL, [{ id: 1, name: "a", commits: [week - 5 * MIN, week + 5 * MIN], claude: [], files: [] }]);
    expect(result.projects[0].minutes[0]).toBeGreaterThan(0);
  });
});

describe("normalizeJournal and formatMinutes", () => {
  it("clamps nonsense and fills the gaps", () => {
    expect(normalizeJournal({ gapMinutes: 100000, paddingMinutes: -5 })).toMatchObject({ gapMinutes: 240, paddingMinutes: 0, commits: true });
    expect(normalizeJournal(undefined)).toEqual(DEFAULT_JOURNAL);
  });
  it("writes hours and minutes", () => {
    expect(formatMinutes(0)).toBe("");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(125)).toBe("2 h 05");
  });
});
