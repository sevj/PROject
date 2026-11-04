import { describe, expect, it } from "vitest";
import { parseStatusPaths } from "./activity-sampler";

describe("parseStatusPaths", () => {
  it("reads the paths of a porcelain -z status, skipping the old name of a rename", () => {
    const out = [" M src/a.ts", "?? new.txt", "R  renamed.ts", "old.ts", "A  added.ts"].join("\0") + "\0";
    expect(parseStatusPaths(out)).toEqual(["src/a.ts", "new.txt", "renamed.ts", "added.ts"]);
  });
  it("is empty for a clean tree", () => {
    expect(parseStatusPaths("")).toEqual([]);
  });
});
