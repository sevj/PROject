import { existsSync, lstatSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const MAX_FAVICON_BYTES = 512 * 1024;

const TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/** A repository can keep its site in a subfolder. */
const PREFIXES = ["", "frontend", "front", "client", "web", "apps/web"];
/** Where frameworks keep the site's icon: Next.js, Vite, Symfony, Laravel, SvelteKit, Godot… */
const FOLDERS = [
  "",
  "public",
  "public/images",
  "public/img",
  "public/assets",
  "public/assets/images",
  "src/app",
  "app",
  "static",
  "web",
  "assets",
  "assets/images",
  "assets/img",
];
/** Scalable first, then the sharpest bitmaps, such as `favicon-32x32.png`. A logo is a last resort. */
const NAMES = [/^favicon\.svg$/, /^icon\.svg$/, /^apple-touch-icon\.png$/, /^icon\.png$/, /^favicon[\w.-]*\.png$/, /^favicon\.ico$/, /^logo\.svg$/];

export type Favicon = { path: string; type: string; version: number };

function isUsable(path: string): { mtimeMs: number } | null {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  return stat?.isFile() && stat.size > 0 && stat.size <= MAX_FAVICON_BYTES ? stat : null;
}

/**
 * The best icon of the project, looked for in the few folders where sites keep one.
 * The page lists every project on each render, so folders are listed rather than probed file by file.
 * Symlinks are refused: they could point anywhere on the machine.
 */
export function findFavicon(projectPath: string): Favicon | null {
  for (const prefix of PREFIXES) {
    const base = join(projectPath, prefix);
    if (prefix && !existsSync(base)) continue;
    let best: { rank: number; path: string; mtimeMs: number } | null = null;
    for (const folder of FOLDERS) {
      const dir = join(base, folder);
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        const rank = NAMES.findIndex((pattern) => pattern.test(name));
        if (rank < 0 || (best && best.rank <= rank)) continue;
        const path = join(dir, name);
        const stat = isUsable(path);
        if (stat) best = { rank, path, mtimeMs: stat.mtimeMs };
      }
    }
    if (best) return { path: best.path, type: TYPES[extname(best.path)], version: Math.round(best.mtimeMs) };
  }
  return null;
}

export async function readFavicon(projectPath: string): Promise<{ body: Buffer; type: string } | null> {
  const favicon = findFavicon(projectPath);
  if (!favicon) return null;
  try {
    return { body: await readFile(favicon.path), type: favicon.type };
  } catch {
    return null;
  }
}
