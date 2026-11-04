import { describe, expect, it } from "vitest";
import {
  computeStats,
  countView,
  formatAge,
  formatSize,
  type RegistryRow,
  selectRows,
  todoReasons,
} from "./registry";

const DAY = 24 * 3600 * 1000;
const NOW = 1000 * DAY;

function row(name: string, patch: Partial<RegistryRow> = {}): RegistryRow {
  return {
    id: 1,
    name,
    path: `~/Projects/${name}`,
    parentName: null,
    kind: "project",
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
    lastCommitAt: NOW - DAY,
    lastCommitSubject: "x",
    weeklyCommits: null,
    hasCompose: false,
    containers: [],
    sizeBytes: null,
    scanError: null,
    ideLabel: "VS Code",
    status: null,
    favorite: false,
    note: null,
    collectionIds: [],
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
  row("plain", { kind: "folder", hasGit: false, dirtyCount: null, lastCommitAt: null }),
  row("gone", { missing: true, dirtyCount: 9 }),
  row("broken", { kind: "folder", hasGit: false, dirtyCount: null, lastCommitAt: null, scanError: "EACCES" }),
];

const names = (list: RegistryRow[]) => list.map((item) => item.name);

describe("selectRows", () => {
  it("shows projects only in the default view, most recent first and empty ones last", () => {
    expect(names(selectRows(rows, { view: "all", query: "", sort: "commit" }))).toEqual([
      "recent",
      "dirty",
      "old",
      "empty",
      "nogit",
    ]);
  });

  it("keeps missing and plain folders in their own views", () => {
    expect(names(selectRows(rows, { view: "missing", query: "", sort: "name" }))).toEqual(["gone"]);
    expect(names(selectRows(rows, { view: "folders", query: "", sort: "name" }))).toEqual(["broken", "plain"]);
    expect(names(selectRows(rows, { view: "errors", query: "", sort: "name" }))).toEqual(["broken"]);
  });

  it("sorts by modified files, and searches the path case-insensitively", () => {
    expect(names(selectRows(rows, { view: "dirty", query: "", sort: "dirty" }))).toEqual(["dirty"]);
    expect(names(selectRows(rows, { view: "all", query: " OLD ", sort: "name" }))).toEqual(["old"]);
  });

  it("does not change the input order", () => {
    const before = names(rows);
    selectRows(rows, { view: "all", query: "", sort: "name" });
    expect(names(rows)).toEqual(before);
  });
});

describe("classification filters", () => {
  const classified = [
    row("a", { collectionIds: [1], favorite: true, tags: ["Client"] }),
    row("b", { collectionIds: [2] }),
    row("c"),
    row("plain", { kind: "folder" }),
  ];

  it("lists unclassified projects, without plain folders", () => {
    expect(names(selectRows(classified, { view: "unclassified", query: "", sort: "name" }))).toEqual(["c"]);
  });

  it("filters by favorite, collection and tag", () => {
    expect(names(selectRows(classified, { view: "favorites", query: "", sort: "name" }))).toEqual(["a"]);
    expect(names(selectRows(classified, { view: "all", query: "", sort: "name", collectionId: 2 }))).toEqual(["b"]);
    expect(names(selectRows(classified, { view: "all", query: "client", sort: "name" }))).toEqual(["a"]);
  });
});

describe("todo view", () => {
  const clean = { upstream: "origin/main", ahead: 0, behind: 0, remoteUrl: "git@x:a/b.git" };

  it.each([
    [{ ...clean }, []],
    [{ ...clean, behind: 4 }, []],
    [{ ...clean, dirtyCount: 1 }, ["1 modif"]],
    [{ ...clean, dirtyCount: 3, ahead: 2 }, ["3 modifs", "2 non poussés"]],
    [{ ...clean, ahead: 1 }, ["1 non poussé"]],
    [{ ...clean, upstream: null, ahead: null }, ["branche sans suivi"]],
    [{ ...clean, upstream: null, ahead: null, branch: null }, []],
    [{ upstream: null, ahead: null, remoteUrl: null }, ["sans remote"]],
    [{ upstream: null, remoteUrl: null, commitCount: 0 }, []],
    [{ hasGit: false, dirtyCount: null }, []],
  ])("explains %j", (patch, expected) => {
    expect(todoReasons(row("x", patch))).toEqual(expected);
  });

  it("lists the oldest first, without archived, missing or clean projects", () => {
    const list = [
      row("recent", { ...clean, dirtyCount: 1, lastCommitAt: NOW - DAY }),
      row("oldest", { ...clean, dirtyCount: 1, lastCommitAt: NOW - 90 * DAY }),
      row("no-commit", { ...clean, dirtyCount: 1, lastCommitAt: null, commitCount: 0 }),
      row("archived", { ...clean, dirtyCount: 1, status: "archived" }),
      row("gone", { ...clean, dirtyCount: 1, missing: true }),
      row("clean", clean),
    ];
    expect(names(selectRows(list, { view: "todo", query: "", sort: "commit" }))).toEqual([
      "oldest",
      "recent",
      "no-commit",
    ]);
    expect(names(selectRows(list, { view: "todo", query: "", sort: "name" }))[0]).toBe("no-commit");
  });
});

describe("computeStats", () => {
  it("counts projects only and excludes missing ones", () => {
    expect(computeStats(rows, NOW)).toEqual({ projects: 5, git: 4, dirty: 1, active30: 1, dormant: 1, running: 1 });
    expect(names(selectRows(rows, { view: "docker", query: "", sort: "name" }))).toEqual(["old"]);
    expect(countView(rows, "nogit")).toBe(1);
  });
});

describe("formatSize", () => {
  it.each([
    [null, "—"],
    [0, "0 o"],
    [1023, "1023 o"],
    [1536, "1,5 Ko"],
    [146 * 1024 * 1024, "146 Mo"],
    [8.8 * 1024 ** 3, "8,8 Go"],
  ])("formats %s as %s", (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected);
  });

  it("sorts unmeasured projects last", () => {
    expect(names(selectRows(rows, { view: "all", query: "", sort: "size" }))[0]).toBe("old");
  });
});

describe("formatAge", () => {
  it.each([
    [null, "aucun"],
    [NOW - 5 * 60_000, "5 min"],
    [NOW - 5 * 3_600_000, "5 h"],
    [NOW - 3 * DAY, "3 j"],
    [NOW - 28 * DAY, "4 sem."],
    [NOW - 150 * DAY, "5 mois"],
    [NOW - 400 * DAY, "1 an"],
    [NOW - 800 * DAY, "2 ans"],
    [NOW + 60_000, "0 min"],
  ])("formats %s as %s", (timestamp, expected) => {
    expect(formatAge(timestamp, NOW)).toBe(expected);
  });
});
