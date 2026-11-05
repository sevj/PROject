import { describe, expect, it } from "vitest";
import {
  bestVersions,
  fromComposerJson,
  fromComposerLock,
  fromImage,
  fromNvmrc,
  fromPackageJson,
  lowestAllowed,
  parseReleases,
  type Release,
  releaseOf,
  supportOf,
} from "./versions";

describe("reading versions", () => {
  it("knows images by their own name and reads their tag", () => {
    expect(fromImage("php", "8.3-fpm-alpine")).toMatchObject({ product: "php", version: "8.3", source: "image" });
    expect(fromImage("wodby/php", "8.2-4.50")).toMatchObject({ product: "php", version: "8.2" });
    expect(fromImage("registry.example:5000/team/postgres", "15.4")).toMatchObject({ product: "postgresql", version: "15.4" });
    expect(fromImage("node", "22-alpine")).toMatchObject({ product: "nodejs", version: "22" });
    expect(fromImage("mysql", "latest")).toBeNull();
    expect(fromImage("nginx", "1.27")).toBeNull();
    expect(fromImage("phpmyadmin", "5")).toBeNull();
  });

  it("takes the lowest version a constraint allows", () => {
    expect(lowestAllowed("^8.1")).toBe("8.1");
    expect(lowestAllowed(">=8.2 <8.4")).toBe("8.2");
    expect(lowestAllowed("~7.4.0 || ^8.0")).toBe("7.4");
    expect(lowestAllowed("*")).toBeNull();
  });

  it("reads what composer installed and what it asks for", () => {
    const lock = { packages: [{ name: "symfony/http-kernel", version: "v6.4.12" }, { name: "symfony/framework-bundle", version: "v6.4.13" }, { name: "drupal/core", version: "10.3.6" }] };
    expect(fromComposerLock(lock)).toEqual([
      { product: "symfony", version: "6.4.13", source: "lock", from: "composer.lock · symfony/framework-bundle" },
      { product: "drupal", version: "10.3.6", source: "lock", from: "composer.lock · drupal/core" },
    ]);
    expect(fromComposerLock("junk")).toEqual([]);
    expect(fromComposerJson({ require: { php: ">=8.2" } })).toMatchObject([{ product: "php", version: "8.2", source: "constraint" }]);
  });

  it("reads Node from .nvmrc and engines", () => {
    expect(fromNvmrc("v20.11.1\n")).toMatchObject([{ product: "nodejs", version: "20.11.1" }]);
    expect(fromNvmrc("lts/*")).toEqual([]);
    expect(fromPackageJson({ engines: { node: ">=18" } })).toMatchObject([{ version: "18", source: "constraint" }]);
  });

  it("keeps the surest version of each product", () => {
    const best = bestVersions([...fromComposerJson({ require: { php: "^8.1" } }), fromImage("php", "8.3-fpm")!, ...fromNvmrc("22")]);
    expect(best.map(({ product, version }) => [product, version])).toEqual([
      ["php", "8.3"],
      ["nodejs", "22"],
    ]);
  });
});

describe("support", () => {
  const releases: Release[] = [
    { name: "8.4", eoasFrom: "2026-12-31", eolFrom: "2028-12-31", latest: "8.4.14", isLts: false },
    { name: "8.3", eoasFrom: "2025-12-31", eolFrom: "2027-12-31", latest: "8.3.36", isLts: false },
    { name: "8.2", eoasFrom: "2024-12-31", eolFrom: "2027-01-31", latest: "8.2.30", isLts: false },
    { name: "8.1", eoasFrom: "2023-11-25", eolFrom: "2025-12-31", latest: "8.1.34", isLts: false },
    { name: "22", eoasFrom: null, eolFrom: "2027-04-30", latest: "22.20.0", isLts: true },
  ];
  const now = Date.parse("2026-11-05");

  it("finds the line of a version", () => {
    expect(releaseOf("8.3.12", releases)?.name).toBe("8.3");
    expect(releaseOf("22.4", releases)?.name).toBe("22");
    expect(releaseOf("7.4", releases)).toBeNull();
    expect(releaseOf("8", releases)?.name).toBe("8.4");
  });

  it("tells active, security only, ending soon and ended", () => {
    expect(supportOf(releases[0], now)).toBe("active");
    expect(supportOf(releases[1], now)).toBe("security");
    expect(supportOf(releases[2], now)).toBe("soon");
    expect(supportOf(releases[3], now)).toBe("eol");
    expect(supportOf(null, now)).toBe("unknown");
  });

  it("reads endoflife.date's answer", () => {
    expect(parseReleases({ result: { releases: [{ name: "8.3", eoasFrom: "2025-12-31", eolFrom: "2027-12-31", isLts: false, latest: { name: "8.3.36" } }, { nope: 1 }] } })).toEqual([
      { name: "8.3", eoasFrom: "2025-12-31", eolFrom: "2027-12-31", latest: "8.3.36", isLts: false },
    ]);
    expect(parseReleases({ error: "x" })).toBeNull();
  });
});
