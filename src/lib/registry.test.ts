import { describe, expect, it } from "vitest";
import {
  computeStats,
  countTags,
  countView,
  formatAge,
  formatSize,
  type RegistryRow,
  selectRows,
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
  row("plain", { kind: "folder", hasGit: false, dirtyCount: null, lastCommitAt: null }),
  row("gone", { missing: true, dirtyCount: 9 }),
  row("dropped", { abandoned: true, dirtyCount: 7, containers: [{ name: "c", service: "c", state: "running", status: "Up", ports: "" }] }),
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

  it("shows abandoned projects only in their own view, even once deleted", () => {
    expect(names(selectRows(rows, { view: "abandoned", query: "", sort: "name" }))).toEqual(["dropped"]);
    const deleted = [row("deleted", { abandoned: true, missing: true })];
    expect(names(selectRows(deleted, { view: "abandoned", query: "", sort: "name" }))).toEqual(["deleted"]);
    expect(names(selectRows(deleted, { view: "all", query: "", sort: "name" }))).toEqual([]);
  });

  it("sorts by modified files, and searches the path case-insensitively", () => {
    expect(names(selectRows(rows, { view: "all", query: "", sort: "dirty" }))[0]).toBe("dirty");
    expect(names(selectRows(rows, { view: "all", query: " OLD ", sort: "name" }))).toEqual(["old"]);
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
    row("plain", { kind: "folder" }),
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

describe("computeStats", () => {
  it("counts projects only, without missing or abandoned ones", () => {
    expect(computeStats(rows, NOW)).toEqual({ projects: 5, git: 4, dirty: 1, active30: 1, dormant: 1, running: 1 });
    expect(countView(rows, "abandoned")).toBe(1);
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
