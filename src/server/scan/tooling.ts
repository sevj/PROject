import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VersionFact } from "../db/schema";

export type Tooling = {
  versions: VersionFact[];
  packageManagers: string[];
  ci: string[];
  testTools: string[];
  description: string | null;
};

const LOCK_FILES: Record<string, string> = {
  "composer.lock": "Composer",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "Yarn",
  "package-lock.json": "npm",
  "bun.lock": "Bun",
  "bun.lockb": "Bun",
  "Cargo.lock": "Cargo",
  "go.sum": "Go modules",
  "poetry.lock": "Poetry",
  "uv.lock": "uv",
};

const CI_FILES: Record<string, string> = {
  ".gitlab-ci.yml": "GitLab CI",
  "azure-pipelines.yml": "Azure Pipelines",
  "bitbucket-pipelines.yml": "Bitbucket Pipelines",
  Jenkinsfile: "Jenkins",
};

const TEST_FILES: [RegExp, string][] = [
  [/^phpunit\.xml(\.dist)?$/, "PHPUnit"],
  [/^codeception\.ya?ml$/, "Codeception"],
  [/^vitest\.config\.\w+$/, "Vitest"],
  [/^jest\.config\.\w+$/, "Jest"],
  [/^playwright\.config\.\w+$/, "Playwright"],
  [/^cypress\.config\.\w+$/, "Cypress"],
  [/^pytest\.ini$/, "pytest"],
];

const COMPOSER_PACKAGES: Record<string, string> = {
  php: "PHP",
  "symfony/framework-bundle": "Symfony",
  "laravel/framework": "Laravel",
  "drupal/core": "Drupal",
};

const NODE_PACKAGES: Record<string, string> = {
  next: "Next.js",
  nuxt: "Nuxt",
  react: "React",
  vue: "Vue",
  "@angular/core": "Angular",
  svelte: "Svelte",
  expo: "Expo",
  express: "Express",
  typescript: "TypeScript",
};

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_DESCRIPTION = 300;

type Manifest = Record<string, unknown>;

async function readJson(path: string): Promise<Manifest | null> {
  try {
    const content = await readFile(path, "utf8");
    if (content.length > MAX_MANIFEST_BYTES) return null;
    const parsed: unknown = JSON.parse(content);
    return parsed && typeof parsed === "object" ? (parsed as Manifest) : null;
  } catch {
    return null;
  }
}

function dependencies(manifest: Manifest, key: string): Record<string, unknown> {
  const value = manifest[key];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickVersions(deps: Record<string, unknown>, known: Record<string, string>): VersionFact[] {
  return Object.entries(known).flatMap(([name, label]) => {
    const value = deps[name];
    // "workspace:*" says nothing about the version in use.
    return typeof value === "string" && !value.startsWith("workspace:") ? [{ label, value }] : [];
  });
}

function descriptionOf(manifest: Manifest | null): string | null {
  const value = manifest?.description;
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\s+/g, " ");
  return clean ? clean.slice(0, MAX_DESCRIPTION) : null;
}

async function readFolder(path: string, files: string[]) {
  const versions: VersionFact[] = [];
  const descriptions: (string | null)[] = [];

  if (files.includes("composer.json")) {
    const composer = await readJson(join(path, "composer.json"));
    if (composer) versions.push(...pickVersions(dependencies(composer, "require"), COMPOSER_PACKAGES));
    descriptions.push(descriptionOf(composer));
  }
  if (files.includes("package.json")) {
    const node = await readJson(join(path, "package.json"));
    if (node) {
      const engine = dependencies(node, "engines").node;
      if (typeof engine === "string") versions.push({ label: "Node", value: engine });
      versions.push(
        ...pickVersions({ ...dependencies(node, "devDependencies"), ...dependencies(node, "dependencies") }, NODE_PACKAGES),
      );
    }
    descriptions.push(descriptionOf(node));
  }
  if (files.includes(".nvmrc")) {
    try {
      const value = (await readFile(join(path, ".nvmrc"), "utf8")).trim();
      if (value && value.length < 40) versions.push({ label: "Node", value });
    } catch {
      // A version hint is not worth reporting an error for.
    }
  }
  if (files.includes("go.mod")) {
    try {
      const match = /^go\s+(\S+)/m.exec(await readFile(join(path, "go.mod"), "utf8"));
      if (match) versions.push({ label: "Go", value: match[1] });
    } catch {
      // Same as above.
    }
  }

  return {
    versions,
    description: descriptions.find((item) => item !== null) ?? null,
    packageManagers: files.flatMap((file) => LOCK_FILES[file] ?? []),
    testTools: TEST_FILES.flatMap(([pattern, label]) => (files.some((file) => pattern.test(file)) ? [label] : [])),
  };
}

/**
 * Reads manifests and marker files only. `folders` is the project root, followed by
 * its subfolders when a repository keeps its manifests in `backend/` and `frontend/`.
 */
export async function readTooling(folders: { path: string; files: string[] }[]): Promise<Tooling> {
  const results = await Promise.all(folders.map(({ path, files }) => readFolder(path, files)));
  const [root] = folders;
  const versions = new Map<string, string>();
  for (const { label, value } of results.flatMap((result) => result.versions)) {
    if (!versions.has(label)) versions.set(label, value);
  }
  const ci = root ? root.files.flatMap((file) => CI_FILES[file] ?? []) : [];
  if (root && existsSync(join(root.path, ".github", "workflows"))) ci.push("GitHub Actions");

  return {
    versions: [...versions].map(([label, value]) => ({ label, value })),
    packageManagers: [...new Set(results.flatMap((result) => result.packageManagers))],
    testTools: [...new Set(results.flatMap((result) => result.testTools))],
    ci,
    description: results.find((result) => result.description !== null)?.description ?? null,
  };
}
