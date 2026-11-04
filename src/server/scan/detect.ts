import { type Dirent, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type DetectedKind = "project" | "group" | "folder";

export type DetectedFolder = {
  path: string;
  name: string;
  kind: DetectedKind;
  parentPath: string | null;
  hasGit: boolean;
  hasCompose: boolean;
  stacks: string[];
  docs: string[];
  envFiles: string[];
  error: string | null;
};

const MANIFESTS: Record<string, string> = {
  "composer.json": "PHP",
  "package.json": "Node",
  "Cargo.toml": "Rust",
  "go.mod": "Go",
  "pyproject.toml": "Python",
  "requirements.txt": "Python",
  "project.godot": "Godot",
};

// A project without git or a root manifest, like rust/ + godot/ driven by a Makefile.
const PROJECT_FILES = new Set(["Makefile", "justfile", "AGENTS.md", "CLAUDE.md"]);
const COMPOSE_FILE =/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/;
const ENV_FILE = /^\.env(\.[\w-]+)*$/;
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
    // A `.git` file is a worktree or a submodule, which still counts as a repository.
    if (entry.name === ".git") hasGit = true;
    else if (entry.isFile()) files.push(entry.name);
    // Symlinks are not followed: they could leave the root or form a cycle.
    else if (entry.isDirectory()) dirs.push(entry.name);
  }
  return { files, dirs, hasGit };
}

function stacksOf(files: string[]): string[] {
  return [...new Set(files.flatMap((file) => MANIFESTS[file] ?? []))];
}

function hasMarkers({ files, hasGit }: Listing): boolean {
  return (
    hasGit ||
    stacksOf(files).length > 0 ||
    files.some((file) => COMPOSE_FILE.test(file) || PROJECT_FILES.has(file))
  );
}

function isVisitable(dir: string): boolean {
  return !dir.startsWith(".") && !IGNORED_DIRS.has(dir);
}

/** A repository can keep its manifests in `backend/` and `frontend/`. */
async function nestedStacks(path: string, dirs: string[]): Promise<string[]> {
  const found = await Promise.all(
    dirs.filter(isVisitable).map(async (dir) => {
      try {
        return stacksOf((await list(join(path, dir))).files);
      } catch {
        return [];
      }
    }),
  );
  return [...new Set(found.flat())].sort();
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

async function describeProject(
  path: string,
  name: string,
  parentPath: string | null,
  listing: Listing,
): Promise<DetectedFolder> {
  const rootStacks = stacksOf(listing.files);
  return {
    path,
    name,
    kind: "project",
    parentPath,
    hasGit: listing.hasGit,
    hasCompose: listing.files.some((file) => COMPOSE_FILE.test(file)),
    stacks: rootStacks.length > 0 ? rootStacks : await nestedStacks(path, listing.dirs),
    docs: await docsOf(path, listing),
    // Names only: values are read on demand and never stored.
    envFiles: listing.files.filter((file) => ENV_FILE.test(file)).sort(),
    error: null,
  };
}

function emptyFolder(path: string, name: string, kind: DetectedKind, error: string | null): DetectedFolder {
  return {
    path,
    name,
    kind,
    parentPath: null,
    hasGit: false,
    hasCompose: false,
    stacks: [],
    docs: [],
    envFiles: [],
    error,
  };
}

async function detectFolder(path: string, name: string): Promise<DetectedFolder[]> {
  let listing: Listing;
  try {
    listing = await list(path);
  } catch (error) {
    return [emptyFolder(path, name, "folder", (error as NodeJS.ErrnoException).code ?? String(error))];
  }

  if (hasMarkers(listing)) {
    return [await describeProject(path, name, null, listing)];
  }

  const children = await Promise.all(
    listing.dirs.filter(isVisitable).map(async (dir) => {
      const childPath = join(path, dir);
      try {
        const childListing = await list(childPath);
        return hasMarkers(childListing) ? describeProject(childPath, dir, path, childListing) : null;
      } catch {
        return null;
      }
    }),
  );
  const projects = children.filter((child) => child !== null);
  if (projects.length > 0) {
    return [emptyFolder(path, name, "group", null), ...projects];
  }
  return [emptyFolder(path, name, "folder", null)];
}

/** Lists what lives under `root`. Writes nothing and never opens a `.env` file. */
export async function detectFolders(root: string): Promise<DetectedFolder[]> {
  if (!existsSync(root)) {
    throw new Error(`Le dossier racine n'existe pas : ${root}`);
  }
  const { dirs } = await list(root);
  const visitable = dirs.filter(isVisitable).sort((a, b) => a.localeCompare(b));
  const detected = await Promise.all(visitable.map((dir) => detectFolder(join(root, dir), dir)));
  return detected.flat();
}
