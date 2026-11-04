import { type Dirent, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ENV_FILE } from "../project-files";
import { readTooling, type Tooling } from "./tooling";

export type DetectedFolder = {
  path: string;
  name: string;
  hasGit: boolean;
  hasCompose: boolean;
  stacks: string[];
  docs: string[];
  envFiles: string[];
  tooling: Tooling;
  error: string | null;
};

const NO_TOOLING: Tooling = { versions: [], packageManagers: [], ci: [], testTools: [], description: null };

const MANIFESTS: Record<string, string> = {
  "composer.json": "PHP",
  "package.json": "Node",
  "Cargo.toml": "Rust",
  "go.mod": "Go",
  "pyproject.toml": "Python",
  "requirements.txt": "Python",
  "project.godot": "Godot",
};

export const COMPOSE_FILE = /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/;
const ROOT_DOC = /^(readme|changelog|agents|claude|todo|roadmap)(\.[\w-]+)?\.(md|txt|rst)$/i;
const DOC_FILE = /\.(md|txt|rst)$/i;
const IGNORED_DIRS = new Set(["node_modules", "vendor", "target", "dist", "build", "var", ".git"]);

type Listing = { files: string[]; dirs: string[]; hasGit: boolean };

async function list(path: string): Promise<Listing> {
  const entries: Dirent[] = await readdir(path, { withFileTypes: true });
  const files: string[] = [];
  const dirs: string[] = [];
  let hasGit = false;
  for (const entry of entries) {
    // A `.git` file is a worktree or a submodule. A `.git` folder without HEAD, such as
    // an empty one, is not a repository.
    if (entry.name === ".git") hasGit = entry.isFile() || existsSync(join(path, ".git", "HEAD"));
    else if (entry.isFile()) files.push(entry.name);
    // Symlinks are not followed: they could form a cycle.
    else if (entry.isDirectory()) dirs.push(entry.name);
  }
  return { files, dirs, hasGit };
}

function stacksOf(files: string[]): string[] {
  return [...new Set(files.flatMap((file) => MANIFESTS[file] ?? []))];
}

function isVisitable(dir: string): boolean {
  return !dir.startsWith(".") && !IGNORED_DIRS.has(dir);
}

/** A repository can keep its manifests in `backend/` and `frontend/`. */
async function nestedFolders(path: string, dirs: string[]): Promise<{ path: string; files: string[] }[]> {
  const found = await Promise.all(
    dirs.filter(isVisitable).map(async (dir) => {
      const childPath = join(path, dir);
      try {
        return { path: childPath, files: (await list(childPath)).files };
      } catch {
        return null;
      }
    }),
  );
  return found.filter((item) => item !== null);
}

async function docsOf(path: string, listing: Listing): Promise<string[]> {
  const docs = listing.files.filter((file) => ROOT_DOC.test(file)).sort();
  if (listing.dirs.includes("docs")) {
    try {
      const { files } = await list(join(path, "docs"));
      docs.push(...files.filter((file) => DOC_FILE.test(file)).sort().map((file) => `docs/${file}`));
    } catch {
      // An unreadable docs folder is not worth failing the project for.
    }
  }
  return docs;
}

/** Reads what a project's folder contains. Writes nothing and never opens a `.env` file. */
export async function readFolder(path: string, name: string): Promise<DetectedFolder> {
  let listing: Listing;
  try {
    listing = await list(path);
  } catch (error) {
    return {
      path,
      name,
      hasGit: false,
      hasCompose: false,
      stacks: [],
      docs: [],
      envFiles: [],
      tooling: NO_TOOLING,
      error: (error as NodeJS.ErrnoException).code ?? String(error),
    };
  }
  const rootStacks = stacksOf(listing.files);
  const nested = rootStacks.length > 0 ? [] : await nestedFolders(path, listing.dirs);
  return {
    path,
    name,
    hasGit: listing.hasGit,
    hasCompose: listing.files.some((file) => COMPOSE_FILE.test(file)),
    stacks: rootStacks.length > 0 ? rootStacks : [...new Set(nested.flatMap(({ files }) => stacksOf(files)))].sort(),
    docs: await docsOf(path, listing),
    // Names only: values are read on demand and never stored.
    envFiles: listing.files.filter((file) => ENV_FILE.test(file)).sort(),
    tooling: await readTooling([{ path, files: listing.files }, ...nested]),
    error: null,
  };
}
