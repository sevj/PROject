import { describe, expect, it } from "vitest";
import { checkAliases, DEFAULT_ALIASES, expandAlias, followLine, normalizeAliases } from "./aliases";

describe("checkAliases", () => {
  it("keeps the edited rows in order, trimmed, and drops empty ones", () => {
    expect(
      checkAliases([
        { name: " sf:cc ", command: " php bin/console c:c " },
        { name: "", command: "  " },
        { name: "sf:prod", command: "php bin/console c:c --env=prod" },
      ]),
    ).toEqual([
      { name: "sf:cc", command: "php bin/console c:c" },
      { name: "sf:prod", command: "php bin/console c:c --env=prod" },
    ]);
    expect(checkAliases([])).toEqual([]);
  });

  it("says which row is wrong", () => {
    expect(checkAliases([{ name: "ok", command: "ls" }, { name: "bad name", command: "ls" }])).toEqual({ row: 2, reason: "name" });
    expect(checkAliases([{ name: "ls", command: "" }])).toEqual({ row: 1, reason: "command" });
    expect(checkAliases([{ name: "two", command: "ls\nrm -rf /" }])).toEqual({ row: 1, reason: "command" });
    expect(checkAliases([{ name: "a", command: "ls" }, { name: "a", command: "pwd" }])).toEqual({ row: 2, reason: "twice" });
    expect(checkAliases(Array.from({ length: 51 }, (_, i) => ({ name: `a${i}`, command: "ls" })))).toEqual({ reason: "tooMany" });
  });
});

describe("normalizeAliases", () => {
  it("starts with the Symfony ones, and keeps an emptied list empty", () => {
    expect(normalizeAliases(undefined)).toEqual(DEFAULT_ALIASES);
    expect(normalizeAliases([])).toEqual([]);
  });

  it("drops what could not be typed safely", () => {
    expect(
      normalizeAliases([
        { name: "ok", command: " ls " },
        { name: "two", command: "ls\nrm -rf /" },
        { name: "ok", command: "pwd" },
        { name: "bad name", command: "ls" },
        "junk",
      ]),
    ).toEqual([{ name: "ok", command: "ls" }]);
  });
});

describe("typing an alias", () => {
  const type = (keys: string[]) => keys.reduce<string | null>(followLine, "");

  it("follows plain typing, backspace and pastes", () => {
    expect(type(["s", "f", ":", "c", "x", "\u007f", "c"])).toBe("sf:cc");
    expect(type(["sf:", "amc"])).toBe("sf:amc");
  });

  it("stops knowing the line after an arrow or Tab, until it is emptied", () => {
    expect(type(["s", "\u001b[A", "f"])).toBeNull();
    expect(type(["sf", "\t"])).toBeNull();
    expect(type(["\u001b[A", "\u0015", "sf:cc"])).toBe("sf:cc");
    expect(type(["x", "\u0003", "sf:cc"])).toBe("sf:cc");
  });

  it("expands only an alias alone on its line", () => {
    expect(expandAlias(DEFAULT_ALIASES, " sf:cc ")).toBe("php bin/console c:c");
    expect(expandAlias(DEFAULT_ALIASES, "sf:cc --env=prod")).toBeNull();
    expect(expandAlias(DEFAULT_ALIASES, "ls")).toBeNull();
  });
});
