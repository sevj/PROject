import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { displayPath } from "./registry";
import { expandHome } from "./projects";

export type DirectoryListing = {
  path: string;
  /** What goes in a directory field: with `~`, or relative to the root when there is one. */
  value: string;
  parent: string | null;
  entries: { name: string; path: string }[];
  /** Only when files are asked for, by their extension. */
  files: { name: string; path: string; value: string }[];
  readable: boolean;
};

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Names of folders, and of the files with these extensions when given. A path being typed may not exist yet. */
export function listDirectories(requested: string, root?: string, extensions: string[] = []): DirectoryListing {
  const base = root ? resolve(expandHome(root.trim())) : null;
  const typed = expandHome(requested.trim());
  let path = typed ? resolve(base ?? homedir(), typed) : (base ?? homedir());
  // A sub-project must stay inside its multi-project, so that is as far up as it goes.
  if (base && path !== base && !path.startsWith(`${base}/`)) path = base;
  while (!isDirectory(path) && path !== dirname(path) && path !== base) path = dirname(path);

  const parent = path === base || path === dirname(path) ? null : dirname(path);
  const value = base ? path.slice(base.length + 1) : displayPath(path);
  try {
    const all = readdirSync(path, { withFileTypes: true }).filter((entry) => !entry.name.startsWith("."));
    const wanted = extensions.map((extension) => `.${extension.toLowerCase()}`);
    const files = all
      .filter((entry) => entry.isFile() && wanted.some((extension) => entry.name.toLowerCase().endsWith(extension)))
      .map(({ name }) => ({ name, path: join(path, name), value: displayPath(join(path, name)) }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    const entries = all
      // A link to a folder is a folder here, as in any file dialog.
      .filter((entry) => entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(join(path, entry.name))))
      .map(({ name }) => ({ name, path: join(path, name) }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return { path, value, parent, entries, files, readable: true };
  } catch {
    return { path, value, parent, entries: [], files: [], readable: false };
  }
}

/** Where a file someone was sent usually lands. */
export function downloadsFolder(): string {
  return ["Téléchargements", "Downloads"].map((name) => join(homedir(), name)).find(isDirectory) ?? homedir();
}
