import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readTooling } from "./tooling";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(files: Record<string, string>) {
  const path = mkdtempSync(join(tmpdir(), "pm-tooling-"));
  dirs.push(path);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(path, name, ".."), { recursive: true });
    writeFileSync(join(path, name), content);
  }
  return { path, files: Object.keys(files).filter((name) => !name.includes("/")) };
}

describe("readTooling", () => {
  it("reads versions, lock files, CI, test tools and the description", async () => {
    const tooling = await readTooling([
      folder({
        "composer.json": JSON.stringify({
          description: "  Mon   appli ",
          require: { php: ">=8.5", "symfony/framework-bundle": "8.1.*", "other/pkg": "1" },
        }),
        "composer.lock": "{}",
        "package.json": JSON.stringify({
          engines: { node: ">=22" },
          dependencies: { next: "16.4.3", shared: "workspace:*" },
          devDependencies: { typescript: "^5" },
        }),
        "pnpm-lock.yaml": "",
        "phpunit.xml.dist": "",
        "vitest.config.mts": "",
        ".gitlab-ci.yml": "",
        ".github/workflows/ci.yml": "",
      }),
    ]);
    expect(tooling.versions).toEqual([
      { label: "PHP", value: ">=8.5" },
      { label: "Symfony", value: "8.1.*" },
      { label: "Node", value: ">=22" },
      { label: "Next.js", value: "16.4.3" },
      { label: "TypeScript", value: "^5" },
    ]);
    expect(tooling.packageManagers.sort()).toEqual(["Composer", "pnpm"]);
    expect(tooling.testTools.sort()).toEqual(["PHPUnit", "Vitest"]);
    expect(tooling.ci.sort()).toEqual(["GitHub Actions", "GitLab CI"]);
    expect(tooling.description).toBe("Mon appli");
  });

  it("merges subfolders, keeping the first value of each version", async () => {
    const tooling = await readTooling([
      folder({ ".nvmrc": "22\n" }),
      folder({ "package.json": JSON.stringify({ engines: { node: ">=18" }, dependencies: { react: "19" } }) }),
      folder({ "composer.json": JSON.stringify({ require: { php: "^8" } }), "composer.lock": "" }),
    ]);
    expect(tooling.versions).toEqual([
      { label: "Node", value: "22" },
      { label: "React", value: "19" },
      { label: "PHP", value: "^8" },
    ]);
    expect(tooling.packageManagers).toEqual(["Composer"]);
  });

  it("reads the Go version", async () => {
    const tooling = await readTooling([folder({ "go.mod": "module x\n\ngo 1.24.2\n", "go.sum": "" })]);
    expect(tooling.versions).toEqual([{ label: "Go", value: "1.24.2" }]);
    expect(tooling.packageManagers).toEqual(["Go modules"]);
  });

  it("tolerates broken or unusual manifests", async () => {
    const tooling = await readTooling([
      folder({
        "composer.json": "pas du json",
        "package.json": JSON.stringify({ description: 12, dependencies: { next: 3 }, engines: "x" }),
      }),
    ]);
    expect(tooling).toEqual({ versions: [], packageManagers: [], testTools: [], ci: [], description: null });
  });
});
