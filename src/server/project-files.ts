import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";

export const ENV_FILE = /^\.env(\.[\w-]+)*$/;
const MAX_DOC_BYTES = 512 * 1024;
const MAX_ENV_BYTES = 256 * 1024;

export type EnvEntry = { key: string; value: string };

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

export function parseEnv(content: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  for (const rawLine of content.split(/\r\n|\r|\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*)$/.exec(rawLine);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    const quoted = /^(["'])(.*?)\1/.exec(value);
    entries.push({ key, value: quoted ? quoted[2] : value.replace(/\s+#.*$/, "") });
  }
  return entries;
}

/** Null when the name is not a `.env` file at the project root. Never cached or logged. */
export async function readEnvFile(projectPath: string, fileName: string): Promise<EnvEntry[] | null> {
  if (!ENV_FILE.test(fileName)) return null;
  const content = await readRegularFile(join(projectPath, fileName), MAX_ENV_BYTES);
  return content === null ? null : parseEnv(content);
}

/** Regenerable or internal folders: shown so that they are known to exist, never opened. */
const OPAQUE_DIRECTORIES = new Set([".git", "node_modules", "vendor", "target"]);
const MAX_TREE_ENTRIES = 500;

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
