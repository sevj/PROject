import { describe, expect, it } from "vitest";
import {
  countTags,
  countView,
  formatAge,
  formatSize,
  groupRows,
  type RegistryRow,
  selectRows,
} from "./registry";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";

const DAY = 24 * 3600 * 1000;
const NOW = 1000 * DAY;

function row(name: string, patch: Partial<RegistryRow> = {}): RegistryRow {
  return {
    id: 1,
    name,
    folderName: name,
    path: `~/Projects/${name}`,
    parentId: null,
    parentName: null,
    parentFolderName: null,
    parentPath: null,
    parentDescription: null,
    parentMissing: false,
    parentSizeBytes: null,
    subdirectory: null,
    missing: false,
    stacks: [],
    hasGit: true,
    branch: "main",
    upstream: null,
    ahead: null,
    behind: null,
    dirtyCount: 0,
    remoteUrl: null,
    commitCount: 1,
    branchCount: 1,
    stashCount: 0,
    firstCommitAt: null,
    lastCommitAuthor: null,
    lastCommitAt: NOW - DAY,
    lastCommitSubject: "x",
    weeklyCommits: null,
    hasCompose: false,
    containers: [],
    sizeBytes: null,
    depsBytes: null,
    gitBytes: null,
    versions: [],
    packageManagers: [],
    ci: [],
    testTools: [],
    docs: [],
    envFiles: [],
    manifestDescription: null,
    description: null,
    scanError: null,
    ideLabel: "VS Code",
    status: null,
    favorite: false,
    note: null,
    abandoned: false,
    tags: [],
    ...patch,
  };
}

const rows = [
  row("recent", { lastCommitAt: NOW - DAY }),
  row("dirty", { dirtyCount: 5, lastCommitAt: NOW - 40 * DAY }),
  row("old", {
    lastCommitAt: NOW - 400 * DAY,
    sizeBytes: 500,
    containers: [
      { name: "a", service: "a", state: "running", status: "Up", ports: "" },
      { name: "b", service: "b", state: "exited", status: "Exited", ports: "" },
    ],
  }),
  row("empty", { lastCommitAt: null, commitCount: 0 }),
  row("nogit", { hasGit: false, dirtyCount: null, lastCommitAt: null }),
  row("gone", { missing: true, dirtyCount: 1 }),
  row("dropped", { abandoned: true, dirtyCount: 7, containers: [{ name: "c", service: "c", state: "running", status: "Up", ports: "" }] }),
];

const names = (list: RegistryRow[]) => list.map((item) => item.name);

describe("selectRows", () => {
  it("keeps a project whose folder moved in the default view, most recent first and empty ones last", () => {
    expect(names(selectRows(rows, { view: "all", query: "", sort: "commit" }))).toEqual([
      "gone",
      "recent",
      "dirty",
      "old",
      "empty",
      "nogit",
    ]);
  });

  it("shows abandoned projects only in their own view, even once deleted", () => {
    expect(countView(rows, "abandoned")).toBe(1);
    expect(countView(rows, "all")).toBe(6);
    expect(names(selectRows(rows, { view: "abandoned", query: "", sort: "name" }))).toEqual(["dropped"]);
    const deleted = [row("deleted", { abandoned: true, missing: true })];
    expect(names(selectRows(deleted, { view: "abandoned", query: "", sort: "name" }))).toEqual(["deleted"]);
    expect(names(selectRows(deleted, { view: "all", query: "", sort: "name" }))).toEqual([]);
  });

  it("sorts by modified files, and searches the path case-insensitively", () => {
    expect(names(selectRows(rows, { view: "all", query: "", sort: "dirty" }))[0]).toBe("dirty");
    expect(names(selectRows(rows, { view: "all", query: " OLD ", sort: "name" }))).toEqual(["old"]);
  });

  it("finds a project by its chosen name", () => {
    const named = [row("Mon outil", { path: "~/Projects/tool", folderName: "tool" })];
    expect(names(selectRows(named, { view: "all", query: "outil", sort: "name" }))).toEqual(["Mon outil"]);
    expect(names(selectRows(named, { view: "all", query: "tool", sort: "name" }))).toEqual(["Mon outil"]);
  });

  it("searches the description, the user's first", () => {
    const list = [
      row("a", { description: "Outil interne", manifestDescription: "Autre chose" }),
      row("b", { manifestDescription: "Autre chose" }),
    ];
    expect(names(selectRows(list, { view: "all", query: "interne", sort: "name" }))).toEqual(["a"]);
    expect(names(selectRows(list, { view: "all", query: "autre", sort: "name" }))).toEqual(["b"]);
  });

  it("does not change the input order", () => {
    const before = names(rows);
    selectRows(rows, { view: "all", query: "", sort: "name" });
    expect(names(rows)).toEqual(before);
  });
});

describe("tag filters", () => {
  const tagged = [
    row("a", { tags: ["Client", "PHP"] }),
    row("b", { tags: ["Client"] }),
    row("c"),
    row("dropped", { tags: ["Client"], abandoned: true }),
  ];
  const select = (options: { tags?: string[]; untagged?: boolean }) =>
    names(selectRows(tagged, { view: "all", query: "", sort: "name", ...options }));

  it("requires every selected tag", () => {
    expect(select({ tags: ["Client"] })).toEqual(["a", "b"]);
    expect(select({ tags: ["Client", "PHP"] })).toEqual(["a"]);
    expect(select({ tags: ["Absent"] })).toEqual([]);
  });

  it("lists untagged projects, without plain folders", () => {
    expect(select({ untagged: true })).toEqual(["c"]);
  });

  it("finds a project through a tag in the search", () => {
    expect(names(selectRows(tagged, { view: "all", query: "php", sort: "name" }))).toEqual(["a"]);
  });

  it("counts within the current view", () => {
    const all = countTags(tagged, "all");
    expect(all.counts.get("Client")).toBe(2);
    expect(all.untagged).toBe(1);
    expect(countTags(tagged, "abandoned").counts.get("Client")).toBe(1);
  });
});

describe("groupRows", () => {
  const child = (name: string, patch: Partial<RegistryRow> = {}) =>
    row(name, { parentId: 7, parentName: "platform", parentFolderName: "platform", ...patch });
  const week = (commits: number) => Array<number>(26).fill(0).with(25, commits);
  const summary = (list: ReturnType<typeof groupRows>) =>
    list.map((item) => (item.kind === "project" ? item.row.name : `[${item.group.rows.map((r) => r.name).join(",")}]`));

  it("places a block at its first project and keeps the order inside", () => {
    const list = [row("a"), child("core"), row("b"), child("form"), row("c", { parentId: 9, parentName: "other" })];
    expect(summary(groupRows(list))).toEqual(["a", "[core,form]", "b", "[c]"]);
  });

  it("adds up what the block contains", () => {
    const running = { name: "c", service: "c", state: "running", status: "Up", ports: "" };
    const [item] = groupRows([
      child("core", { dirtyCount: 2, sizeBytes: 100, lastCommitAt: NOW - DAY, weeklyCommits: week(3), containers: [running] }),
      child("form", { dirtyCount: 5, sizeBytes: 50, lastCommitAt: NOW - 9 * DAY, weeklyCommits: week(4), containers: [running, running] }),
      child("nogit", { hasGit: false, dirtyCount: null, lastCommitAt: null }),
    ]);
    if (item.kind !== "group") throw new Error("expected a group");
    expect(item.group).toMatchObject({
      parentId: 7,
      name: "platform",
      dirtyCount: 7,
      running: 3,
      sizeBytes: 150,
      lastCommitAt: NOW - DAY,
    });
    expect(item.group.weeklyCommits?.at(-1)).toBe(7);
  });

  it("prefers the measured size of the folder, which counts its own files", () => {
    const list = [child("core", { sizeBytes: 100, parentSizeBytes: 9000 }), child("form", { sizeBytes: 50, parentSizeBytes: 9000 })];
    const [item] = groupRows(list);
    const [summed] = groupRows(list, { useFolderSize: false });
    if (item.kind !== "group" || summed.kind !== "group") throw new Error("expected a group");
    expect(item.group.sizeBytes).toBe(9000);
    expect(summed.group.sizeBytes).toBe(150);
  });

  it("names the block after the name chosen for the folder", () => {
    const [item] = groupRows([child("core", { parentName: "Plateforme", parentFolderName: "platform" })]);
    if (item.kind !== "group") throw new Error("expected a group");
    expect(item.group).toMatchObject({ name: "Plateforme", folderName: "platform" });
  });

  it("has no total when nothing was measured", () => {
    const [item] = groupRows([child("nogit", { hasGit: false, lastCommitAt: null })]);
    if (item.kind !== "group") throw new Error("expected a group");
    expect(item.group).toMatchObject({ sizeBytes: null, lastCommitAt: null, weeklyCommits: null });
  });
});

describe("formatSize", () => {
  it.each([
    [null, "—"],
    [0, "0 B"],
    [1023, "1023 B"],
    [1536, "1.5 KB"],
    [146 * 1024 * 1024, "146 MB"],
    [8.8 * 1024 ** 3, "8.8 GB"],
  ])("formats %s as %s", (bytes, expected) => {
    expect(formatSize(bytes, en.size)).toBe(expected);
  });

  it("sorts unmeasured projects last", () => {
    expect(names(selectRows(rows, { view: "all", query: "", sort: "size" }))[0]).toBe("old");
  });
});

describe("formatAge", () => {
  it.each([
    [null, "none"],
    [NOW - 5 * 60_000, "5 min"],
    [NOW - 5 * 3_600_000, "5 h"],
    [NOW - 3 * DAY, "3 d"],
    [NOW - 28 * DAY, "4 wk"],
    [NOW - 150 * DAY, "5 mo"],
    [NOW - 400 * DAY, "1 yr"],
    [NOW - 800 * DAY, "2 yrs"],
    [NOW + 60_000, "0 min"],
  ])("formats %s as %s", (timestamp, expected) => {
    expect(formatAge(timestamp, NOW, en.age)).toBe(expected);
  });
});

describe("French formats", () => {
  it("uses its own units, decimals and plurals", () => {
    expect(formatSize(1536, fr.size)).toBe("1,5 Ko");
    expect(formatAge(NOW - 3 * DAY, NOW, fr.age)).toBe("3 j");
    expect(formatAge(NOW - 800 * DAY, NOW, fr.age)).toBe("2 ans");
    expect(formatAge(NOW - 400 * DAY, NOW, fr.age)).toBe("1 an");
  });
});
