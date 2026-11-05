import { describe, expect, it } from "vitest";
import { groupContainers, idsToAct, type OverviewContainer, parseOverview } from "./docker-overview";

const line = (fields: string[]) => fields.join("\t");
const OUTPUT = [
  line(["a1", "villette-php-1", "php:8.3-fpm", "running", "Up 2 hours (healthy)", "9000/tcp", "villette", "php", "/home/me/Projects/villette/docker"]),
  line(["a2", "villette-db-1", "mysql:8", "exited", "Exited (0) 3 days ago", "", "villette", "db", "/home/me/Projects/villette/docker"]),
  line(["b1", "other-web-1", "nginx", "running", "Up 5 minutes", "0.0.0.0:8080->80/tcp", "other", "web", "/tmp/other"]),
  line(["c1", "loose", "redis", "exited", "Exited (1) 1 hour ago", "", "", "", ""]),
  line(["d1", "shop-app-1", "node:22", "exited", "Exited (0) 1 week ago", "", "shop", "app", "/home/me/Projects/shop"]),
].join("\n");

const containers = parseOverview(`${OUTPUT}\n`);
const PROJECTS = [
  { id: 1, name: "Projects", path: "/home/me/Projects" },
  { id: 2, name: "La Villette", path: "/home/me/Projects/villette" },
  { id: 3, name: "Shop", path: "/home/me/Projects/shop" },
];

describe("parseOverview", () => {
  it("reads each line, with its state as the app words it", () => {
    expect(containers).toHaveLength(5);
    expect(containers[0]).toMatchObject({ id: "a1", name: "villette-php-1", kind: "running", running: true, service: "php", composeProject: "villette" });
    expect(containers[3]).toMatchObject({ kind: "failed", running: false, composeProject: "" });
  });
});

describe("groupContainers", () => {
  it("puts each under the deepest project, else its compose project, else with the loose ones", () => {
    const groups = groupContainers(containers, PROJECTS);
    expect(groups.map(({ key, label, projectId }) => [key, label, projectId])).toEqual([
      ["project:2", "La Villette", 2],
      ["compose:other", "other", null],
      ["project:3", "Shop", 3],
      ["loose", "", null],
    ]);
    expect(groups[0].containers.map(({ id }) => id)).toEqual(["a1", "a2"]);
  });
});

describe("idsToAct", () => {
  it("keeps only listed containers for which the action makes sense", () => {
    expect(idsToAct("stop", ["a1", "a2", "zz"], containers)).toEqual(["a1"]);
    expect(idsToAct("start", ["a1", "a2"], containers)).toEqual(["a2"]);
    expect(idsToAct("restart", ["b1", "c1"], containers)).toEqual(["b1"]);
    expect(idsToAct("stop", [], [] as OverviewContainer[])).toEqual([]);
  });
});
