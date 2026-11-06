import { execFile } from "node:child_process";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { type EnvEntry, parseEnv } from "@/lib/env-file";
import type { CodeToken } from "./highlight";

export type { EnvEntry };
export { parseEnv };

export const ENV_FILE = /^\.env(\.[\w-]+)*$/;
const MAX_DOC_BYTES = 512 * 1024;
export const MAX_ENV_BYTES = 256 * 1024;

function isInside(relative: string): boolean {
  const clean = normalize(relative);
  return !isAbsolute(clean) && clean !== ".." && !clean.startsWith("../");
}

/** Symlinks are refused: they could point anywhere on the machine. */
async function readRegularFile(path: string, maxBytes: number): Promise<string | null> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export function readProjectDoc(projectPath: string, relative: string): Promise<string | null> {
  if (!isInside(relative)) return Promise.resolve(null);
  return readRegularFile(join(projectPath, relative), MAX_DOC_BYTES);
}

/** Null when the name is not a `.env` file at the project root. Never cached or logged. */
export async function readEnvFile(projectPath: string, fileName: string): Promise<EnvEntry[] | null> {
  if (!ENV_FILE.test(fileName)) return null;
  const content = await readRegularFile(join(projectPath, fileName), MAX_ENV_BYTES);
  return content === null ? null : parseEnv(content);
}

const MAX_SOURCE_BYTES = 1024 * 1024;

export type SourceFile =
  /** `tokens` is set by the caller that colors it, null when it stays plain. */
  | { kind: "text"; content: string; sizeBytes: number; tokens?: CodeToken[][] | null }
  | { kind: "binary" | "tooLarge"; sizeBytes: number }
  /** Its values are secrets: the Env tab shows them, masked. */
  | { kind: "env" }
  | { kind: "unreadable" };

/** For the file explorer, read-only. A link, or a path leading out of the project, is not read. */
export async function readProjectSource(projectPath: string, relative: string): Promise<SourceFile> {
  if (!isInside(relative)) return { kind: "unreadable" };
  const clean = normalize(relative);
  if (ENV_FILE.test(clean.split("/").pop() ?? "")) return { kind: "env" };
  const path = join(projectPath, clean);
  try {
    const [realRoot, realFile, stat] = await Promise.all([realpath(projectPath), realpath(path), lstat(path)]);
    if (!realFile.startsWith(`${realRoot}/`) || !stat.isFile()) return { kind: "unreadable" };
    if (stat.size > MAX_SOURCE_BYTES) return { kind: "tooLarge", sizeBytes: stat.size };
    const bytes = await readFile(path);
    // What git itself looks at to tell a binary file.
    if (bytes.subarray(0, 8000).includes(0)) return { kind: "binary", sizeBytes: stat.size };
    return { kind: "text", content: bytes.toString("utf8"), sizeBytes: stat.size };
  } catch {
    return { kind: "unreadable" };
  }
}

/** Regenerable or internal folders: shown so that they are known to exist, never opened. */
const OPAQUE_DIRECTORIES = new Set([".git", "node_modules", "vendor", "target"]);
const MAX_TREE_ENTRIES = 500;
const SIZE_TIMEOUT_MS = 60_000;

export type TreeEntry = {
  name: string;
  /** From the project root, which is what asks for the content of a folder. */
  path: string;
  kind: "directory" | "file" | "link";
  sizeBytes: number | null;
  opaque: boolean;
};

export type TreeListing = { entries: TreeEntry[]; hiddenCount: number };

/** One level at a time, folders first. Null when it is outside the project or unreadable. */
export async function listProjectFolder(projectPath: string, relative: string): Promise<TreeListing | null> {
  if (!isInside(relative)) return null;
  const clean = normalize(relative);
  const folder = join(projectPath, clean);
  try {
    // A link on the way must not lead out of the project.
    const [realRoot, realFolder] = await Promise.all([realpath(projectPath), realpath(folder)]);
    if (realFolder !== realRoot && !realFolder.startsWith(`${realRoot}/`)) return null;

    const all = await readdir(folder, { withFileTypes: true });
    const sorted = all.sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, "fr"),
    );
    const shown = sorted.slice(0, MAX_TREE_ENTRIES);
    const entries = await Promise.all(
      shown.map(async (entry): Promise<TreeEntry> => {
        const path = clean === "." ? entry.name : join(clean, entry.name);
        const directory = entry.isDirectory();
        return {
          name: entry.name,
          path,
          kind: directory ? "directory" : entry.isSymbolicLink() ? "link" : "file",
          sizeBytes: entry.isFile() ? await lstat(join(folder, entry.name)).then(({ size }) => size, () => null) : null,
          opaque: directory && OPAQUE_DIRECTORIES.has(entry.name),
        };
      }),
    );
    return { entries, hiddenCount: sorted.length - shown.length };
  } catch {
    return null;
  }
}

/**
 * What each entry of a folder weighs on disk, folders included. Null when it takes too long or
 * cannot be read: the listing is still right without it. The path was checked like a listing's.
 */
export async function readFolderSizes(projectPath: string, relative: string): Promise<Record<string, number> | null> {
  if (!isInside(relative)) return null;
  const folder = join(projectPath, normalize(relative));
  try {
    const [realRoot, realFolder] = await Promise.all([realpath(projectPath), realpath(folder)]);
    if (realFolder !== realRoot && !realFolder.startsWith(`${realRoot}/`)) return null;
    const output = await new Promise<string>((resolve, reject) => {
      // Exits with 1 on a root-owned subfolder (Docker volumes), and still prints the rest.
      execFile("du", ["-x", "--block-size=1", "--all", "--max-depth=1", "--", realFolder], { timeout: SIZE_TIMEOUT_MS, maxBuffer: 16 << 20 }, (error, stdout) => {
        if (error?.killed) reject(error);
        else resolve(stdout);
      });
    });
    const sizes: Record<string, number> = {};
    for (const line of output.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab === -1) continue;
      const path = line.slice(tab + 1);
      if (path.startsWith(`${realFolder}/`)) sizes[path.slice(realFolder.length + 1)] = Number(line.slice(0, tab));
    }
    return sizes;
  } catch {
    return null;
  }
}
