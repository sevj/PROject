/** A command typed into a local console by a click, under a short name such as `sf:cc`. */
export type CommandAlias = { name: string; command: string };

export const DEFAULT_ALIASES: CommandAlias[] = [
  { name: "sf:cc", command: "php bin/console c:c" },
  { name: "sf:amc", command: "php bin/console asset-map:compile" },
];

const NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,31}$/;
const COMMAND_LIMIT = 1000;
export const ALIAS_LIMIT = 50;

/** One command, on one line: a line break would run what follows it as well. */
const isCommand = (command: string) => command.length > 0 && command.length <= COMMAND_LIMIT && !/[\r\n\0]/.test(command);

/** What was stored, kept only where it is still sound: a bad entry must not break the consoles. */
export function normalizeAliases(value: unknown): CommandAlias[] {
  if (!Array.isArray(value)) return DEFAULT_ALIASES;
  const seen = new Set<string>();
  const aliases: CommandAlias[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { name, command } = item as Record<string, unknown>;
    if (typeof name !== "string" || typeof command !== "string") continue;
    if (!NAME.test(name) || !isCommand(command.trim()) || seen.has(name)) continue;
    seen.add(name);
    aliases.push({ name, command: command.trim() });
  }
  return aliases.slice(0, ALIAS_LIMIT);
}

export type AliasProblem = { row: number; reason: "name" | "command" | "twice" } | { reason: "tooMany" };

/** The list as edited, in its order: rows left wholly empty are dropped, `row` counts from 1. */
export function checkAliases(rows: { name: string; command: string }[]): CommandAlias[] | AliasProblem {
  const aliases: CommandAlias[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rows.entries()) {
    const name = String(raw?.name ?? "").trim();
    const command = String(raw?.command ?? "").trim();
    if (!name && !command) continue;
    if (!NAME.test(name)) return { row: index + 1, reason: "name" };
    if (!isCommand(command)) return { row: index + 1, reason: "command" };
    if (seen.has(name)) return { row: index + 1, reason: "twice" };
    seen.add(name);
    aliases.push({ name, command });
  }
  return aliases.length > ALIAS_LIMIT ? { reason: "tooMany" } : aliases;
}

/** The command of the alias typed alone on a line, spaces aside. */
export const expandAlias = (aliases: CommandAlias[], line: string) => aliases.find(({ name }) => name === line.trim())?.command ?? null;

/**
 * What the line holds after `data` was typed, as far as the terminal can tell: null once it
 * cannot, after an arrow, Tab or a recalled line, whose text only the shell knows.
 */
export function followLine(line: string | null, data: string): string | null {
  if (data === "\u007f" || data === "\b") return line === null ? null : line.slice(0, -1);
  // Ctrl+U and Ctrl+C both leave an empty line.
  if (data === "\u0015" || data === "\u0003") return "";
  if (/^[^\u0000-\u001f\u007f]+$/.test(data)) return line === null ? null : line + data;
  return null;
}
