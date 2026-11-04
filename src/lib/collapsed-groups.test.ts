import { describe, expect, it } from "vitest";
import { parseCollapsedGroups, toggleCollapsedGroup } from "./collapsed-groups";

describe("parseCollapsedGroups", () => {
  it("reads what was stored", () => {
    expect(parseCollapsedGroups("[3,7]")).toEqual([3, 7]);
  });

  it.each(["", "not json", "{}", "12", "null"])("finds nothing in %j", (stored) => {
    expect(parseCollapsedGroups(stored)).toEqual([]);
  });

  it("keeps only what can be a project", () => {
    expect(parseCollapsedGroups('[1,"2",null,3.5,4]')).toEqual([1, 4]);
  });
});

describe("toggleCollapsedGroup", () => {
  it("collapses a group, then expands it", () => {
    const collapsed = toggleCollapsedGroup("", 3);
    expect(parseCollapsedGroups(collapsed)).toEqual([3]);
    expect(parseCollapsedGroups(toggleCollapsedGroup(collapsed, 3))).toEqual([]);
  });

  it("leaves the other groups as they are", () => {
    expect(parseCollapsedGroups(toggleCollapsedGroup("[1,2]", 3))).toEqual([1, 2, 3]);
    expect(parseCollapsedGroups(toggleCollapsedGroup("[1,2,3]", 2))).toEqual([1, 3]);
  });
});
