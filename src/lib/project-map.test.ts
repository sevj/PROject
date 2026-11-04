import { describe, expect, it } from "vitest";
import { layerServices, layoutMap, type MapService, projectNodeId, serviceId, toMapState } from "./project-map";

const service = (name: string, dependsOn: string[] = [], over: Partial<MapService> = {}): MapService => ({
  name,
  image: null,
  engine: null,
  state: "running",
  ports: [],
  dependsOn,
  ...over,
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
    { id: 1, name: "Shop", services: [service("app", ["db"]), service("db", [], { engine: "postgres" }), service("mail")] },
    { id: 2, name: "Blog", services: [service("web")] },
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
