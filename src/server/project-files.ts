import { lstat, readFile } from "node:fs/promises";
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
