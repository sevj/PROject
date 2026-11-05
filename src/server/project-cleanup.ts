import { execFile } from "node:child_process";
import { lstat, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { mapLimit } from "./scan/limit";

export type CleanableKind = "dependencies" | "build" | "cache" | "logs";
export type Cleanable = { name: string; kind: CleanableKind; bytes: number };
export type CleanupResult = { freedBytes: number; failures: { name: string; message: string }[] };

/**
 * Only these, and only those git ignores with nothing tracked in them. `var` as a whole is not
 * among them: an application can keep real data there, such as a SQLite file or uploads.
 */
const KNOWN: Record<string, CleanableKind> = {
  node_modules: "dependencies",
  vendor: "dependencies",
  target: "build",
  dist: "build",
  build: "build",
  ".next": "build",
  ".nuxt": "build",
  "var/cache": "cache",
  ".cache": "cache",
  ".turbo": "cache",
  ".phpunit.cache": "cache",
  ".pytest_cache": "cache",
  __pycache__: "cache",
  coverage: "cache",
  "var/log": "logs",
};

const CONCURRENCY = 3;
const MEASURE_TIMEOUT_MS = 120_000;

function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: 30_000, maxBuffer: 1 << 20, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" } },
      (error, stdout) => resolve({ code: error ? (typeof error.code === "number" ? error.code : 128) : 0, stdout }),
    );
  });
}

function measure(path: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile("du", ["-sx", "--block-size=1", "--", path], { timeout: MEASURE_TIMEOUT_MS }, (error, stdout) => {
      // du exits with 1 on a root-owned subfolder (Docker volumes) and still prints its total.
      const bytes = Number.parseInt(stdout, 10);
      resolve(error?.killed || Number.isNaN(bytes) ? null : bytes);
    });
  });
}

/** A real folder of this project, not a link to something else that happens to have this name. */
async function isOwnFolder(root: string, name: string): Promise<boolean> {
  try {
    const path = join(root, name);
    const [realRoot, realPath, stat] = await Promise.all([realpath(root), realpath(path), lstat(path)]);
    return stat.isDirectory() && realPath === join(realRoot, name);
  } catch {
    return false;
  }
}

async function isRegenerable(root: string, name: string): Promise<boolean> {
  if (!(await isOwnFolder(root, name))) return false;
  const [ignored, tracked] = await Promise.all([
    git(root, ["check-ignore", "-q", "--", `${name}/`]),
    git(root, ["ls-files", "--", name]),
  ]);
  return ignored.code === 0 && tracked.code === 0 && tracked.stdout === "";
}

/** The biggest first. Without git, nothing tells what can be made again: nothing is offered. */
export async function readCleanable(root: string): Promise<Cleanable[]> {
  const found = await mapLimit(Object.entries(KNOWN), CONCURRENCY, async ([name, kind]): Promise<Cleanable[]> => {
    if (!(await isRegenerable(root, name))) return [];
    const bytes = await measure(join(root, name));
    return bytes ? [{ name, kind, bytes }] : [];
  });
  return found.flat().sort((a, b) => b.bytes - a.bytes);
}

/** The names come from the browser: only what is offered right now can be removed. */
export async function removeCleanable(root: string, names: string[]): Promise<CleanupResult> {
  const offered = await readCleanable(root);
  const result: CleanupResult = { freedBytes: 0, failures: [] };
  for (const { name, bytes } of offered.filter(({ name }) => names.includes(name))) {
    try {
      await rm(join(root, name), { recursive: true, force: true, maxRetries: 2 });
      result.freedBytes += bytes;
    } catch (error) {
      // Often files a container wrote as root: the rest of the folder may be gone already.
      result.failures.push({ name, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
