import { describe, expect, it } from "vitest";
import { detectEngine, isCompatible, isRedis, isValidDatabaseName } from "./db-engines";

describe("detectEngine", () => {
  it.each([
    ["postgres:16-alpine", "postgres"],
    ["postgres", "postgres"],
    ["docker.io/library/postgres:13@sha256:abc", "postgres"],
    ["postgis/postgis:16-3.4", "postgres"],
    ["bitnami/postgresql:15", "postgres"],
    ["timescale/timescaledb:latest-pg16", "postgres"],
    ["mysql:9.7.0", "mysql"],
    ["percona/percona-server:8.0", "mysql"],
    ["mariadb:10.11.2", "mariadb"],
    ["bitnami/mariadb", "mariadb"],
    ["mongo:7", "mongodb"],
    ["registry.local:5000/mongodb/mongodb-community-server:7", "mongodb"],
  ])("recognizes %s", (image, engine) => {
    expect(detectEngine({ image })).toBe(engine);
  });

  it.each([
    "prometheuscommunity/postgres-exporter",
    "dpage/pgadmin4",
    "mongo-express",
    "tiredofit/db-backup",
    "mysql-client",
    "nginx:alpine",
    "redis:8",
    "betterarmo-server:latest",
  ])("leaves %s alone", (image) => {
    expect(detectEngine({ image })).toBeNull();
  });

  it("looks at the variables only for a container called like a database", () => {
    const envKeys = ["POSTGRES_PASSWORD", "APP_ENV"];
    expect(detectEngine({ image: "gproject-db:latest", service: "db", envKeys })).toBe("postgres");
    expect(detectEngine({ image: "gproject-db:latest", service: "postgres-main", envKeys })).toBe("postgres");
    expect(detectEngine({ image: "gproject-app:latest", service: "app", envKeys })).toBeNull();
    expect(detectEngine({ image: "x:1", service: "db", envKeys: ["MARIADB_ROOT_PASSWORD"] })).toBe("mariadb");
    expect(detectEngine({ image: "x:1", service: "db", envKeys: ["MYSQL_ROOT_PASSWORD"] })).toBe("mysql");
    expect(detectEngine({ image: "x:1", service: "mongo", envKeys: ["MONGO_INITDB_ROOT_USERNAME"] })).toBe("mongodb");
    expect(detectEngine({ image: "x:1", service: "db", envKeys: [] })).toBeNull();
  });
});

describe("isCompatible", () => {
  it("lets MySQL and MariaDB exchange, and nothing else", () => {
    expect(isCompatible("mysql", "mariadb")).toBe(true);
    expect(isCompatible("mariadb", "mysql")).toBe(true);
    expect(isCompatible("postgres", "postgres")).toBe(true);
    expect(isCompatible("postgres", "mysql")).toBe(false);
    expect(isCompatible("mongodb", "postgres")).toBe(false);
  });
});

describe("isValidDatabaseName", () => {
  it("lets through names that need no quoting care", () => {
    for (const name of ["app", "my_db", "db-1", "shop.v2", "a$b"]) expect(isValidDatabaseName(name)).toBe(true);
    for (const name of ["", "-x", "a b", 'a"b', "a;b", "a`b", "x".repeat(64), "é"]) expect(isValidDatabaseName(name)).toBe(false);
  });
});

describe("isRedis", () => {
  it("recognises Redis and its forks, not the tools around it", () => {
    expect(isRedis({ image: "redis:7-alpine" })).toBe(true);
    expect(isRedis({ image: "valkey/valkey:8" })).toBe(true);
    expect(isRedis({ image: "bitnami/redis" })).toBe(true);
    expect(isRedis({ image: "oliver006/redis_exporter" })).toBe(false);
    expect(isRedis({ image: "rediscommander/redis-commander" })).toBe(false);
    expect(isRedis({ image: "redis/redisinsight" })).toBe(false);
    expect(isRedis({ image: "postgres:16" })).toBe(false);
  });

  it("accepts a custom image only when it is called like Redis and carries its variables", () => {
    expect(isRedis({ image: "acme/cache", service: "redis", envKeys: ["REDIS_PASSWORD"] })).toBe(true);
    expect(isRedis({ image: "acme/app", service: "app", envKeys: ["REDIS_URL"] })).toBe(false);
  });
});
