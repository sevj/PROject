import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDockerfile, parseImage, readDockerStack } from "./docker-stack";

let base: string;
let project: string;
const write = (file: string, content: string) => {
  mkdirSync(join(project, file, ".."), { recursive: true });
  writeFileSync(join(project, file), content);
};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "pm-docker-"));
  project = join(base, "project");
  mkdirSync(project);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("parseImage", () => {
  it.each([
    ["postgres:16-alpine", "postgres", "16-alpine"],
    ["redis", "redis", "latest"],
    ["ghcr.io/org/app:1.2", "ghcr.io/org/app", "1.2"],
    ["registry:5000/app", "registry:5000/app", "latest"],
    ["registry:5000/app:2", "registry:5000/app", "2"],
    ["nginx@sha256:0123456789abcdef", "nginx", "sha256:0123456789ab"],
  ])("reads %s", (reference, name, version) => {
    expect(parseImage(reference)).toEqual({ name, version });
  });
});

describe("parseDockerfile", () => {
  it("lists the images of every stage, without the stages themselves", () => {
    const content = `
# FROM commented:out
ARG PHP_VERSION=8.4
FROM node:22 AS assets
FROM --platform=linux/amd64 php:\${PHP_VERSION}-fpm AS base
FROM base AS dev
FROM BASE
FROM scratch
FROM node:22
`;
    expect(parseDockerfile(content)).toEqual([
      { name: "node", version: "22" },
      { name: "php", version: "8.4-fpm" },
    ]);
  });

  it("uses inline defaults, and shows what it cannot resolve as written", () => {
    expect(parseDockerfile("FROM php:${V:-8.3}\nFROM ruby:$UNKNOWN")).toEqual([
      { name: "php", version: "8.3" },
      { name: "ruby", version: "$UNKNOWN" },
    ]);
  });
});

describe("readDockerStack", () => {
  it("reads images, versions, ports and Dockerfiles from Compose", async () => {
    write("docker/Dockerfile", "FROM php:8.4-fpm\n");
    write(
      "docker-compose.yml",
      `
x-common: &common
  restart: always
services:
  db:
    <<: *common
    image: postgres:\${PG:-16}
    ports: ["127.0.0.1:5438:5432", "9000"]
  app:
    build: { context: ., dockerfile: docker/Dockerfile }
    depends_on:
      db:
        condition: service_healthy
      cache: {}
    ports:
      - { published: 8080, target: 80 }
  cache:
    image: redis
`,
    );
    const { components, invalidFiles } = await readDockerStack(project);
    expect(invalidFiles).toEqual([]);
    expect(components).toEqual([
      { service: "db", images: [{ name: "postgres", version: "16" }], builtFrom: null, sources: ["docker-compose.yml"], ports: ["5438:5432", "9000"], dependsOn: [] },
      { service: "app", images: [{ name: "php", version: "8.4-fpm" }], builtFrom: "docker/Dockerfile", sources: ["docker-compose.yml"], ports: ["8080:80"], dependsOn: ["db", "cache"] },
      { service: "cache", images: [{ name: "redis", version: "latest" }], builtFrom: null, sources: ["docker-compose.yml"], ports: [], dependsOn: [] },
    ]);
  });

  it("lets an override complete the base file, whatever the alphabetical order", async () => {
    write("compose.yaml", "services:\n  db:\n    image: postgres:15\n    ports: ['1:1']\n");
    write("compose.override.yaml", "services:\n  db:\n    image: postgres:16\n    ports: ['2:2']\n  mail:\n    image: mailpit\n");
    const { components } = await readDockerStack(project);
    expect(components.map(({ service }) => service)).toEqual(["db", "mail"]);
    expect(components[0]).toMatchObject({
      images: [{ name: "postgres", version: "16" }],
      ports: ["1:1", "2:2"],
      sources: ["compose.yaml", "compose.override.yaml"],
    });
  });

  it("does not let another variant replace a service", async () => {
    write("compose.yaml", "services:\n  db:\n    image: postgres:15\n");
    write("compose.prod.yaml", "services:\n  db:\n    image: postgres:99\n  proxy:\n    image: nginx:1\n");
    const { components } = await readDockerStack(project);
    expect(components[0].images[0].version).toBe("15");
    expect(components[1]).toMatchObject({ service: "proxy", sources: ["compose.prod.yaml"] });
  });

  it("reports a broken file and keeps the others", async () => {
    write("compose.yaml", "services: [unclosed");
    write("compose.prod.yaml", "services:\n  a:\n    image: b\n");
    const { components, invalidFiles } = await readDockerStack(project);
    expect(invalidFiles).toEqual(["compose.yaml"]);
    expect(components.map(({ service }) => service)).toEqual(["a"]);
  });

  it("keeps the declared image when the Dockerfile cannot be read, and never leaves the project", async () => {
    writeFileSync(join(base, "Dockerfile"), "FROM secret:1\n");
    write("compose.yaml", "services:\n  a:\n    image: mine:2\n    build: ..\n  b:\n    build: ./missing\n");
    const { components } = await readDockerStack(project);
    expect(components[0].images).toEqual([{ name: "mine", version: "2" }]);
    expect(components[1]).toMatchObject({ images: [], builtFrom: "missing/Dockerfile" });
  });

  it("falls back on a lone Dockerfile, and is empty without Docker", async () => {
    expect(await readDockerStack(project)).toEqual({ components: [], invalidFiles: [] });
    write("Dockerfile", "FROM golang:1.24\n");
    const { components } = await readDockerStack(project);
    expect(components[0]).toMatchObject({ service: "Dockerfile", images: [{ name: "golang", version: "1.24" }] });
  });

  it("copes with a Compose file without services, or a missing folder", async () => {
    write("compose.yaml", "version: '3'\n");
    expect((await readDockerStack(project)).components).toEqual([]);
    expect((await readDockerStack(join(base, "nope"))).components).toEqual([]);
  });
});
