import { describe, expect, it } from "vitest";
import { axisTicks, niceCeiling, weekLabels } from "./git-activity";

describe("niceCeiling", () => {
  it("rounds up to 1, 2 or 5 times a power of ten", () => {
    expect([0, 1, 2, 3, 5, 6, 10, 11, 21, 51, 99, 101].map(niceCeiling)).toEqual([
      1, 1, 2, 5, 5, 10, 10, 20, 50, 100, 100, 200,
    ]);
  });
});

describe("axisTicks", () => {
  it("only has whole numbers", () => {
    expect(axisTicks(1)).toEqual([1, 0]);
    expect(axisTicks(2)).toEqual([2, 1, 0]);
    expect(axisTicks(5)).toEqual([5, 0]);
    expect(axisTicks(50)).toEqual([50, 25, 0]);
  });
});

describe("weekLabels", () => {
  const now = Date.UTC(2026, 10, 4, 12);

  it("ends on the current week, and marks the month that starts", () => {
    const labels = weekLabels(now, 2, "en-GB", "UTC");
    expect(labels[1]).toEqual({ range: "28 Oct – 4 Nov", month: "Nov" });
    expect(labels[0]).toEqual({ range: "21 Oct – 28 Oct", month: null });
  });

  it("gives the year instead of January", () => {
    const labels = weekLabels(Date.UTC(2026, 0, 3, 12), 1, "en-GB", "UTC");
    expect(labels[0].month).toBe("2026");
  });
});
