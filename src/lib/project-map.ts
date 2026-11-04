import type { Engine } from "./db-engines";

/** The architecture of the projects as a layered graph. Pure: the browser only draws what this decides. */
export type MapState = "running" | "stopped" | "absent" | "other";

export type MapService = {
  name: string;
  image: string | null;
  engine: Engine | null;
  state: MapState;
  ports: string[];
  /** The services this one waits for. */
  dependsOn: string[];
};

export type MapProject = { id: number; name: string; services: MapService[] };

export type MapNode = {
  id: string;
  kind: "project" | "service";
  x: number;
  y: number;
  projectId: number;
  label: string;
  image: string | null;
  engine: Engine | null;
  state: MapState | null;
  ports: string[];
};

export type MapEdge = { id: string; source: string; target: string; kind: "contains" | "depends" };

export type MapLayout = { nodes: MapNode[]; edges: MapEdge[] };

export const COLUMN_WIDTH = 300;
export const ROW_HEIGHT = 96;
const BAND_GAP = 40;

export const serviceId = (projectId: number, service: string) => `s:${projectId}:${service}`;
export const projectNodeId = (projectId: number) => `p:${projectId}`;

/**
 * Longest path from a service nobody waits for: an application sits before the database it
 * needs, which sits before what the database needs. A cycle is cut where it is met.
 */
export function layerServices(services: MapService[]): Map<string, number> {
  const names = new Set(services.map(({ name }) => name));
  const needs = new Map(services.map((service) => [service.name, service.dependsOn.filter((name) => names.has(name) && name !== service.name)]));
  const needed = new Set([...needs.values()].flat());
  const layers = new Map<string, number>();

  const visit = (name: string, layer: number, path: Set<string>) => {
    if (path.has(name)) return;
    if ((layers.get(name) ?? -1) >= layer) return;
    layers.set(name, layer);
    path.add(name);
    for (const next of needs.get(name) ?? []) visit(next, layer + 1, path);
    path.delete(name);
  };
  for (const service of services) if (!needed.has(service.name)) visit(service.name, 0, new Set());
  // A cycle with no entry point leaves services unplaced: they go in the first layer.
  for (const service of services) if (!layers.has(service.name)) layers.set(service.name, 0);
  return layers;
}

export function layoutMap(projects: MapProject[]): MapLayout {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  let top = 0;
  for (const project of projects) {
    const layers = layerServices(project.services);
    const perLayer = new Map<number, MapService[]>();
    for (const service of [...project.services].sort((a, b) => a.name.localeCompare(b.name, "fr"))) {
      const layer = layers.get(service.name) ?? 0;
      perLayer.set(layer, [...(perLayer.get(layer) ?? []), service]);
    }
    const rows = Math.max(1, ...[...perLayer.values()].map((list) => list.length));
    const bandHeight = rows * ROW_HEIGHT;

    nodes.push({
      id: projectNodeId(project.id),
      kind: "project",
      x: 0,
      y: top + (bandHeight - ROW_HEIGHT) / 2,
      projectId: project.id,
      label: project.name,
      image: null,
      engine: null,
      state: null,
      ports: [],
    });

    for (const [layer, list] of perLayer) {
      // A short column is centered in the band, which keeps the edges close to level.
      const offset = ((rows - list.length) * ROW_HEIGHT) / 2;
      list.forEach((service, index) => {
        nodes.push({
          id: serviceId(project.id, service.name),
          kind: "service",
          x: (layer + 1) * COLUMN_WIDTH,
          y: top + offset + index * ROW_HEIGHT,
          projectId: project.id,
          label: service.name,
          image: service.image,
          engine: service.engine,
          state: service.state,
          ports: service.ports,
        });
      });
    }

    const names = new Set(project.services.map(({ name }) => name));
    for (const service of project.services) {
      // The project is linked to the services nobody else waits for: the entry points.
      if (layers.get(service.name) === 0) {
        edges.push({ id: `c:${project.id}:${service.name}`, source: projectNodeId(project.id), target: serviceId(project.id, service.name), kind: "contains" });
      }
      for (const dependency of service.dependsOn) {
        if (names.has(dependency) && dependency !== service.name) {
          edges.push({
            id: `d:${project.id}:${service.name}:${dependency}`,
            source: serviceId(project.id, service.name),
            target: serviceId(project.id, dependency),
            kind: "depends",
          });
        }
      }
    }
    top += bandHeight + BAND_GAP;
  }
  return { nodes, edges };
}

const STOPPED = new Set(["exited", "created", "dead"]);

/** What `docker ps` says a container's state is, in the few words the map needs. */
export function toMapState(state: string): MapState {
  if (state === "running") return "running";
  return STOPPED.has(state) ? "stopped" : "other";
}
