import { describe, expect, it } from "vitest";
import { fuzzyScore, rank, remember } from "./palette";

describe("fuzzyScore", () => {
  it("finds letters in order, whatever accents and case", () => {
    expect(fuzzyScore("villrec", "La Villette · recette")).not.toBeNull();
    expect(fuzzyScore("ete", "Été")).not.toBeNull();
    expect(fuzzyScore("xyz", "La Villette")).toBeNull();
    expect(fuzzyScore("recvill", "La Villette · recette")).toBeNull();
  });

  it("prefers a start, then letters side by side", () => {
    const start = fuzzyScore("vil", "Villette") ?? 0;
    const inside = fuzzyScore("vil", "La Villette") ?? 0;
    const apart = fuzzyScore("vil", "Very ill") ?? 0;
    expect(start).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(apart);
  });
});

describe("rank", () => {
  const items = [
    { id: "a", title: "Ports" },
    { id: "b", title: "Popularity", subtitle: "projet" },
    { id: "c", title: "Prod", subtitle: "GT Solutions · serveur" },
  ];

  it("puts the recent ones first while nothing is typed", () => {
    expect(rank(items, "", ["c", "a"]).map(({ id }) => id)).toEqual(["c", "a", "b"]);
  });

  it("keeps only what matches, the title counting more", () => {
    expect(rank(items, "pop").map(({ id }) => id)).toEqual(["b"]);
    expect(rank(items, "gt").map(({ id }) => id)).toEqual(["c"]);
    expect(rank(items, "po").map(({ id }) => id).slice(0, 2)).toEqual(["a", "b"]);
  });
});

describe("remember", () => {
  it("puts the last one first, once, and keeps eight", () => {
    expect(remember(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(remember(["1", "2", "3", "4", "5", "6", "7", "8"], "9")).toHaveLength(8);
  });
});
