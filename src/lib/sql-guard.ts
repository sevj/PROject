import type { Engine } from "./db-engines";

/**
 * The first line of defense of the SQL editor. The database enforces read-only itself
 * (a read-only session); this refuses what is not a single plain query before it is sent.
 */
export type GuardResult = { ok: true; statement: string } | { ok: false; reason: "empty" | "multiple" | "notReadOnly" | "into" | "unterminated" };

const ALLOWED_FIRST = new Set(["select", "with", "show", "explain", "describe", "desc", "table", "values"]);

type Token = { kind: "word" | "other"; text: string };

/**
 * Splits a statement into words, with strings, quoted names and comments taken out so that
 * a keyword inside them is not mistaken for one. Returns null when something is left open.
 */
function tokenize(sql: string, engine: Engine): { tokens: Token[]; semicolons: number[] } | null {
  const mysql = engine === "mysql" || engine === "mariadb";
  const tokens: Token[] = [];
  const semicolons: number[] = [];
  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    if (/\s/.test(char)) {
      i += 1;
    } else if ((char === "-" && next === "-") || (mysql && char === "#")) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
    } else if (char === "/" && next === "*") {
      // PostgreSQL comments nest; MySQL's do not.
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (!mysql && sql[i] === "/" && sql[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      if (depth > 0) return null;
    } else if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      i += 1;
      let closed = false;
      while (i < sql.length) {
        if (mysql && sql[i] === "\\" && quote !== "`") {
          i += 2;
        } else if (sql[i] === quote && sql[i + 1] === quote) {
          i += 2;
        } else if (sql[i] === quote) {
          i += 1;
          closed = true;
          break;
        } else {
          i += 1;
        }
      }
      if (!closed) return null;
      tokens.push({ kind: "other", text: quote });
    } else if (char === "$" && engine === "postgres") {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        if (end === -1) return null;
        i = end + tag[0].length;
        tokens.push({ kind: "other", text: "$" });
      } else {
        tokens.push({ kind: "other", text: char });
        i += 1;
      }
    } else if (/[A-Za-z_]/.test(char)) {
      const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(i))?.[0] ?? char;
      tokens.push({ kind: "word", text: word.toLowerCase() });
      i += word.length;
    } else {
      if (char === ";") semicolons.push(tokens.length);
      tokens.push({ kind: "other", text: char });
      i += 1;
    }
  }
  return { tokens, semicolons };
}

export function checkReadOnlySql(sql: string, engine: Engine): GuardResult {
  const scanned = tokenize(sql, engine);
  if (!scanned) return { ok: false, reason: "unterminated" };
  // A single trailing semicolon is only a way to end the statement.
  const tokens = [...scanned.tokens];
  while (tokens.at(-1)?.text === ";") tokens.pop();
  if (tokens.length === 0) return { ok: false, reason: "empty" };
  if (tokens.some((token) => token.text === ";")) return { ok: false, reason: "multiple" };
  const first = tokens[0];
  if (first.kind !== "word" || !ALLOWED_FIRST.has(first.text)) return { ok: false, reason: "notReadOnly" };
  // `SELECT ... INTO OUTFILE` writes a file, `SELECT ... INTO table` creates one.
  if (tokens.some((token) => token.kind === "word" && token.text === "into")) return { ok: false, reason: "into" };
  return { ok: true, statement: sql.trim().replace(/[;\s]+$/, "") };
}

/** A name of a table or column, quoted for the engine. The name never ends a quoted string. */
export function quoteIdentifier(name: string, engine: Engine): string {
  if (name === "" || name.length > 128 || /[\0\r\n]/.test(name)) throw new Error("Invalid name");
  return engine === "postgres" ? `"${name.replaceAll('"', '""')}"` : `\`${name.replaceAll("`", "``")}\``;
}

/** `schema.table` for PostgreSQL, whose tables live in schemas. */
export function quoteTable(schema: string | null, table: string, engine: Engine): string {
  return engine === "postgres" && schema ? `${quoteIdentifier(schema, engine)}.${quoteIdentifier(table, engine)}` : quoteIdentifier(table, engine);
}

/** Operators that run JavaScript on the server: a filter has no use for them. */
const MONGO_SCRIPT_OPERATORS = /\$(where|function|accumulator)\b/;

export type MongoFilter = { ok: true; filter: string } | { ok: false; reason: "invalid" | "script" };

export function checkMongoFilter(text: string): MongoFilter {
  const trimmed = text.trim() === "" ? "{}" : text.trim();
  if (MONGO_SCRIPT_OPERATORS.test(trimmed)) return { ok: false, reason: "script" };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "invalid" };
    return { ok: true, filter: JSON.stringify(parsed) };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
