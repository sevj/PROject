/** What the browser gets from a Redis server: text, and never a way to run a command. */
export type RedisKey = { key: string; type: string; ttlMs: number | null };
export type RedisKeyPage = { cursor: string; keys: RedisKey[] };

export type RedisEntry = { label: string; value: string };
export type RedisValue = {
  type: string;
  ttlMs: number | null;
  /** Length, members or fields: the real count, whatever is shown. */
  size: number | null;
  /** A string value, cut at a limit. */
  text: string | null;
  entries: RedisEntry[];
  truncated: boolean;
};

export type RedisInfo = { fields: Record<string, string>; databases: { index: number; keys: number }[] };

export const SCAN_BATCH = 200;
export const VALUE_ITEMS = 100;
export const VALUE_BYTES = 65_536;

/** Lua's JSON encoder writes an empty table as {} where a list is meant. */
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const str = (value: unknown): string => (typeof value === "string" ? value : value === null || value === undefined ? "" : String(value));

/** PTTL answers -1 for a key that never expires and -2 for one that is gone. */
const ttl = (value: unknown): number | null => (typeof value === "number" && value >= 0 ? value : null);

function parseJson(output: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(output.trim());
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseKeyPage(output: string): RedisKeyPage | null {
  const raw = parseJson(output);
  if (!raw) return null;
  const keys = list(raw.keys).flatMap((item) => {
    const [key, type, pttl] = list(item);
    return typeof key === "string" ? [{ key, type: str(type), ttlMs: ttl(pttl) }] : [];
  });
  return { cursor: /^\d+$/.test(str(raw.cursor)) ? str(raw.cursor) : "0", keys };
}

const pairs = (flat: unknown[]): RedisEntry[] => {
  const entries: RedisEntry[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) entries.push({ label: str(flat[i]), value: str(flat[i + 1]) });
  return entries;
};

export function parseValue(output: string): RedisValue | null {
  const raw = parseJson(output);
  if (!raw) return null;
  const type = str(raw.type);
  let entries: RedisEntry[] = [];
  if (type === "list") entries = list(raw.items).map((item, index) => ({ label: String(index), value: str(item) }));
  else if (type === "set") entries = list(raw.items).map((item) => ({ label: "", value: str(item) }));
  else if (type === "hash") entries = pairs(list(raw.items));
  else if (type === "zset") entries = pairs(list(raw.items)).map(({ label, value }) => ({ label: value, value: label }));
  else if (type === "stream") {
    entries = list(raw.items).map((item) => {
      const [id, fields] = list(item);
      return { label: str(id), value: pairs(list(fields)).map((p) => `${p.label}=${p.value}`).join("  ") };
    });
  }
  const size = typeof raw.size === "number" ? raw.size : null;
  const shown = entries.slice(0, VALUE_ITEMS);
  const text = type === "string" ? str(raw.value) : null;
  return {
    type,
    ttlMs: ttl(raw.ttl),
    size,
    text,
    entries: shown,
    truncated: entries.length > VALUE_ITEMS || (size !== null && type !== "string" && size > shown.length) || (text !== null && size !== null && size > VALUE_BYTES),
  };
}

/** `INFO`: `name:value` lines, and one `dbN:keys=…` line per database that holds keys. */
export function parseInfo(output: string): RedisInfo {
  const fields: Record<string, string> = {};
  const databases: { index: number; keys: number }[] = [];
  for (const line of output.split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at <= 0 || line.startsWith("#")) continue;
    const name = line.slice(0, at);
    const value = line.slice(at + 1).trim();
    const db = /^db(\d+)$/.exec(name);
    if (db) databases.push({ index: Number(db[1]), keys: Number(/keys=(\d+)/.exec(value)?.[1] ?? 0) });
    else fields[name] = value;
  }
  return { fields, databases: databases.sort((a, b) => a.index - b.index) };
}

/** Error replies as `redis-cli --raw` prints them. */
export const REDIS_ERROR = /^(ERR|NOAUTH|WRONGPASS|NOPERM|READONLY|LOADING|MISCONF|BUSY|EXECABORT|Error)\b/;

export function checkScanPattern(pattern: string): string | null {
  const trimmed = pattern.trim() === "" ? "*" : pattern.trim();
  return trimmed.length <= 200 && !trimmed.includes("\0") ? trimmed : null;
}

export const checkKey = (key: string): boolean => typeof key === "string" && key.length > 0 && key.length <= 2000 && !key.includes("\0");

export const checkDbIndex = (index: string): number | null => {
  const value = Number(index);
  return /^\d{1,3}$/.test(String(index)) && value >= 0 && value <= 255 ? value : null;
};
