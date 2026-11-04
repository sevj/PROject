import { beforeEach, describe, expect, it } from "vitest";
import { setAbandoned } from "./classification";
import { type Db, openDb } from "./db/client";
import { projectFacts, projects } from "./db/schema";
import { listProjectContainers, parseInspect, toContainerDetail } from "./docker-containers";

const raw = {
  Id: "a".repeat(64),
  Name: "/shop-db-1",
  Created: "2026-10-23T10:00:00.123456789Z",
  Path: "docker-entrypoint.sh",
  Args: ["postgres", "-c", "fsync=off"],
  Image: "sha256:" + "b".repeat(64),
  RestartCount: 2,
  State: {
    Status: "exited",
    Running: false,
    ExitCode: 137,
    StartedAt: "2026-10-23T10:00:01Z",
    FinishedAt: "0001-01-01T00:00:00Z",
    OOMKilled: true,
    Health: { Status: "unhealthy" },
  },
  HostConfig: { RestartPolicy: { Name: "on-failure", MaximumRetryCount: 3 } },
  Config: {
    Image: "postgres:16-alpine",
    Env: ["SECRET=value"],
    Labels: {
      "com.docker.compose.service": "db",
      "com.docker.compose.project": "shop",
      "com.docker.compose.project.config_files": "/p/shop/compose.yaml,/p/shop/compose.override.yaml",
      "com.docker.compose.project.working_dir": "/p/shop",
    },
  },
  NetworkSettings: {
    Ports: {
      "5432/tcp": [
        { HostIp: "0.0.0.0", HostPort: "5438" },
        { HostIp: "::", HostPort: "5438" },
      ],
      "6000/tcp": [{ HostIp: "127.0.0.1", HostPort: "6001" }],
      "80/tcp": null,
    },
    Networks: { shop_default: { IPAddress: "172.18.0.2" }, host2: { IPAddress: "" } },
  },
  Mounts: [
    { Type: "volume", Name: "shop_pgdata", Source: "/var/lib/docker/volumes/shop_pgdata/_data", Destination: "/var/lib/postgresql", RW: true },
    { Type: "bind", Source: "/p/shop/init.sql", Destination: "/init.sql", RW: false },
  ],
};

describe("toContainerDetail", () => {
  it("reads the full name, image, ports, networks and mounts", () => {
    const detail = toContainerDetail(raw, "Exited (137) 2 days ago");
    expect(detail).toMatchObject({
      id: "a".repeat(64),
      name: "shop-db-1",
      service: "db",
      state: "exited",
      status: "Exited (137) 2 days ago",
      running: false,
      health: "unhealthy",
      image: "postgres:16-alpine",
      imageId: "b".repeat(64),
      command: "docker-entrypoint.sh postgres -c fsync=off",
      exitCode: 137,
      outOfMemory: true,
      restartPolicy: "on-failure:3",
      restartCount: 2,
      composeProject: "shop",
      composeFiles: ["/p/shop/compose.yaml", "/p/shop/compose.override.yaml"],
      workingDir: "/p/shop",
    });
    expect(detail.createdAt).toBe(Date.parse("2026-10-23T10:00:00.123Z"));
    expect(detail.finishedAt).toBeNull();
    expect(detail.ports).toEqual([
      { host: "5438", container: "5432/tcp" },
      { host: "127.0.0.1:6001", container: "6000/tcp" },
      { host: null, container: "80/tcp" },
    ]);
    expect(detail.networks).toEqual([
      { name: "shop_default", address: "172.18.0.2" },
      { name: "host2", address: "" },
    ]);
    expect(detail.mounts).toEqual([
      { type: "volume", source: "shop_pgdata", destination: "/var/lib/postgresql", readOnly: false },
      { type: "bind", source: "/p/shop/init.sql", destination: "/init.sql", readOnly: true },
    ]);
  });

  it("recognizes a database by its image, or by a variable name on a container called like one", () => {
    expect(toContainerDetail(raw).engine).toBe("postgres");
    const built = { Config: { Image: "shop-db:latest", Env: ["POSTGRES_PASSWORD=secret"], Labels: { "com.docker.compose.service": "db" } } };
    expect(toContainerDetail(built).engine).toBe("postgres");
    const app = { Config: { Image: "shop-app:latest", Env: ["POSTGRES_PASSWORD=secret"], Labels: { "com.docker.compose.service": "app" } } };
    expect(toContainerDetail(app).engine).toBeNull();
    expect(JSON.stringify(toContainerDetail(built))).not.toContain("secret");
  });

  it("never carries environment variables, even by accident", () => {
    expect(JSON.stringify(toContainerDetail(raw))).not.toContain("SECRET");
  });

  it("copes with a bare container", () => {
    expect(toContainerDetail({ Id: "x", Name: "/a", State: { Running: true, Status: "running" } })).toMatchObject({
      name: "a",
      running: true,
      exitCode: null,
      restartPolicy: "no",
      ports: [],
      mounts: [],
      composeProject: null,
      composeFiles: [],
    });
  });
});

describe("parseInspect", () => {
  it("reads one object per line and skips what is not JSON", () => {
    expect(parseInspect('{"Id":"1"}\nnot json\n\n{"Id":"2"}\n').map(({ Id }) => Id)).toEqual(["1", "2"]);
  });
});

describe("listProjectContainers", () => {
  let db: Db;
  let shop: number;
  let api: number;

  const container = (name: string, workingDir: string, service = name) => ({
    name,
    service,
    state: "running",
    status: `Up ${name}`,
    ports: "",
    workingDir,
  });
  const inspect = async (names: string[]) => names.map((name) => ({ Id: name.padEnd(64, "0"), Name: `/${name}`, State: { Running: true } }));

  beforeEach(() => {
    db = openDb(":memory:");
    const add = (path: string) => {
      const { id } = db.insert(projects).values({ path, name: path }).returning().get();
      db.insert(projectFacts).values({ projectId: id }).run();
      return id;
    };
    shop = add("/p/shop");
    api = add("/p/shop/api");
  });

  it("keeps the containers of this project only, the deepest project winning", async () => {
    const docker = async () => ({
      containers: [container("shop-db-1", "/p/shop", "db"), container("api-1", "/p/shop/api"), container("other-1", "/p/other")],
      error: null,
    });
    const result = await listProjectContainers(db, shop, { docker, inspect });
    expect(result.containers.map(({ name }) => name)).toEqual(["shop-db-1"]);
    expect(result.containers[0].status).toBe("Up shop-db-1");
    expect((await listProjectContainers(db, api, { docker, inspect })).containers.map(({ name }) => name)).toEqual(["api-1"]);
  });

  it("gives an abandoned project's containers to its parent", async () => {
    setAbandoned(db, [api], true);
    const docker = async () => ({ containers: [container("api-1", "/p/shop/api")], error: null });
    expect((await listProjectContainers(db, shop, { docker, inspect })).containers.map(({ name }) => name)).toEqual(["api-1"]);
  });

  it("reports Docker being down, an inspect failure, and an unknown project", async () => {
    expect(await listProjectContainers(db, shop, { docker: async () => ({ containers: [], error: "daemon down" }), inspect })).toEqual({
      containers: [],
      error: "daemon down",
    });
    const failing = await listProjectContainers(db, shop, {
      docker: async () => ({ containers: [container("a", "/p/shop")], error: null }),
      inspect: async () => {
        throw Object.assign(new Error("x"), { stderr: "no such container\n" });
      },
    });
    expect(failing.error).toBe("no such container");
    expect(await listProjectContainers(db, 999, { inspect })).toEqual({ containers: [], error: null });
  });

  it("has no container, and asks Docker nothing more, when none belongs to the project", async () => {
    let inspected = false;
    const result = await listProjectContainers(db, shop, {
      docker: async () => ({ containers: [container("o", "/p/other")], error: null }),
      inspect: async (names) => {
        inspected = true;
        return inspect(names);
      },
    });
    expect(result).toEqual({ containers: [], error: null });
    expect(inspected).toBe(false);
  });
});
