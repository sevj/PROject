import { describe, expect, it } from "vitest";
import {
  isInChoice,
  layerServices,
  layoutMap,
  mapChoices,
  type MapProject,
  type MapService,
  projectNodeId,
  serviceId,
  toMapState,
} from "./project-map";

const service = (name: string, dependsOn: string[] = [], over: Partial<MapService> = {}): MapService => ({
  name,
  image: null,
  engine: null,
  state: "running",
  ports: [],
  dependsOn,
  ...over,
});

describe("mapChoices", () => {
  const project = (id: number, name: string, parent: MapProject["parent"] = null): MapProject => ({
    id,
    name,
    parent,
    services: [],
  });
  const anfr = { id: 10, name: "ANFR" };
  const projects = [project(1, "Zeta"), project(2, "Usager", anfr), project(3, "Alpha"), project(4, "Cross", anfr)];

  it("puts each multi-project among the others, followed by its sub-projects", () => {
    expect(mapChoices(projects)).toEqual([
      { id: 3, name: "Alpha", nested: false },
      { id: 10, name: "ANFR", nested: false },
      { id: 4, name: "Cross", nested: true },
      { id: 2, name: "Usager", nested: true },
      { id: 1, name: "Zeta", nested: false },
    ]);
  });

  it("lists a multi-project once, however many sub-projects it has", () => {
    expect(mapChoices(projects).filter(({ id }) => id === 10)).toHaveLength(1);
  });

  it("does not list what has nothing to show", () => {
    expect(mapChoices([])).toEqual([]);
  });

  it("does not lose a project that is both a parent and on the map", () => {
    const both = [project(10, "ANFR"), project(2, "Usager", anfr)];
    expect(mapChoices(both)).toEqual([
      { id: 10, name: "ANFR", nested: false },
      { id: 2, name: "Usager", nested: true },
    ]);
  });

  describe("isInChoice", () => {
    const ids = (choice: number | null) => projects.filter((item) => isInChoice(item, choice)).map(({ id }) => id);

    it("keeps everything with no choice", () => {
      expect(ids(null)).toEqual([1, 2, 3, 4]);
    });

    it("keeps all the sub-projects of a multi-project", () => {
      expect(ids(10)).toEqual([2, 4]);
    });

    it("keeps one sub-project, or one project, on its own", () => {
      expect(ids(2)).toEqual([2]);
      expect(ids(1)).toEqual([1]);
    });
  });
});

describe("layerServices", () => {
  it("puts what is needed after what needs it", () => {
    const layers = layerServices([service("web", ["app"]), service("app", ["db", "cache"]), service("db"), service("cache"), service("mail")]);
    expect([...layers].sort(([a], [b]) => a.localeCompare(b))).toEqual([["app", 1], ["cache", 2], ["db", 2], ["mail", 0], ["web", 0]]);
  });

  it("takes the longest path when a service is needed at two depths", () => {
    const layers = layerServices([service("web", ["app", "db"]), service("app", ["db"]), service("db")]);
    expect(layers.get("db")).toBe(2);
  });

  it("survives a cycle and an unknown dependency", () => {
    const layers = layerServices([service("a", ["b", "ghost"]), service("b", ["a"])]);
    expect(layers.size).toBe(2);
  });
});

describe("layoutMap", () => {
  const projects = [
    { id: 1, name: "Shop", parent: null, services: [service("app", ["db"]), service("db", [], { engine: "postgres" }), service("mail")] },
    { id: 2, name: "Blog", parent: null, services: [service("web")] },
  ];

  it("places a project, its entry services and what they need in columns", () => {
    const { nodes } = layoutMap(projects);
    const x = (id: string) => nodes.find((node) => node.id === id)?.x;
    expect(x(projectNodeId(1))).toBe(0);
    expect(x(serviceId(1, "app"))).toBeLessThan(x(serviceId(1, "db")) ?? 0);
    expect(x(serviceId(1, "mail"))).toBe(x(serviceId(1, "app")));
  });

  it("stacks the projects without overlapping their rows", () => {
    const { nodes } = layoutMap(projects);
    const ys = (projectId: number) => nodes.filter((node) => node.projectId === projectId).map((node) => node.y);
    expect(Math.min(...ys(2))).toBeGreaterThan(Math.max(...ys(1)));
  });

  it("links a project to its entry services and services to what they need", () => {
    const { edges } = layoutMap(projects);
    expect(edges.map(({ kind, source, target }) => `${kind} ${source}>${target}`).sort()).toEqual(
      [
        `contains ${projectNodeId(1)}>${serviceId(1, "app")}`,
        `contains ${projectNodeId(1)}>${serviceId(1, "mail")}`,
        `contains ${projectNodeId(2)}>${serviceId(2, "web")}`,
        `depends ${serviceId(1, "app")}>${serviceId(1, "db")}`,
      ].sort(),
    );
  });

  it("is empty without projects", () => {
    expect(layoutMap([])).toEqual({ nodes: [], edges: [] });
  });
});

describe("toMapState", () => {
  it("keeps the few states the map shows", () => {
    expect([toMapState("running"), toMapState("exited"), toMapState("created"), toMapState("paused")]).toEqual(["running", "stopped", "stopped", "other"]);
  });
});
