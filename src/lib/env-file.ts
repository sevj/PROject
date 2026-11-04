export type EnvEntry = { key: string; value: string };

type Quote = '"' | "'" | null;

type EnvVariable = EnvEntry & {
  lineStart: number;
  /** After the end of the last line of the variable, line break included. */
  nextLine: number;
  valueStart: number;
  valueEnd: number;
  quote: Quote;
};

export const ENV_KEY = /^[A-Za-z_][\w.-]*$/;

const ASSIGNMENT = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][\w.-]*)[ \t]*=([ \t]*)/;
/** What needs no quotes in any of the dotenv readers. */
const SAFE_UNQUOTED = /^[\w./:@%+,=?~-]*$/;

function endOfLine(content: string, from: number): number {
  for (let index = from; index < content.length; index++) {
    if (content[index] === "\n" || content[index] === "\r") return index;
  }
  return content.length;
}

function afterLineBreak(content: string, lineEnd: number): number {
  if (lineEnd >= content.length) return content.length;
  return content.startsWith("\r\n", lineEnd) ? lineEnd + 2 : lineEnd + 1;
}

/** A value may span several lines between quotes. -1 when the quote is never closed. */
function closingQuote(content: string, opening: number): number {
  const quote = content[opening];
  for (let index = opening + 1; index < content.length; index++) {
    if (quote === '"' && content[index] === "\\") index++;
    else if (content[index] === quote) return index;
  }
  return -1;
}

const DOUBLE_QUOTE_ESCAPES: Record<string, string> = { n: "\n", r: "\r" };

const decodeDoubleQuoted = (raw: string) =>
  raw.replace(/\\(["\\$nr])/g, (_, escaped: string) => DOUBLE_QUOTE_ESCAPES[escaped] ?? escaped);

/** Every assignment with where it sits, so that one can be rewritten without touching the rest. */
function parseVariables(content: string): EnvVariable[] {
  const variables: EnvVariable[] = [];
  let lineStart = 0;
  while (lineStart < content.length) {
    const lineEnd = endOfLine(content, lineStart);
    const match = ASSIGNMENT.exec(content.slice(lineStart, lineEnd));
    if (!match) {
      lineStart = afterLineBreak(content, lineEnd);
      continue;
    }
    const valueStart = lineStart + match[0].length;
    const first = content[valueStart];
    const closing = first === '"' || first === "'" ? closingQuote(content, valueStart) : -1;
    let variable: EnvVariable;
    if (closing !== -1) {
      const raw = content.slice(valueStart + 1, closing);
      variable = {
        key: match[1],
        value: first === '"' ? decodeDoubleQuoted(raw) : raw,
        lineStart,
        nextLine: afterLineBreak(content, endOfLine(content, closing)),
        valueStart,
        valueEnd: closing + 1,
        quote: first as Quote,
      };
    } else {
      const rest = content.slice(valueStart, lineEnd);
      // `A= # note` is empty, but `A=#fff` is a value: a comment follows a space.
      const value = match[2] && rest.startsWith("#") ? "" : rest.replace(/\s+#.*$/, "").trimEnd();
      variable = {
        key: match[1],
        value,
        lineStart,
        nextLine: afterLineBreak(content, lineEnd),
        valueStart,
        valueEnd: valueStart + value.length,
        quote: null,
      };
    }
    variables.push(variable);
    lineStart = variable.nextLine;
  }
  return variables;
}

export function parseEnv(content: string): EnvEntry[] {
  return parseVariables(content).map(({ key, value }) => ({ key, value }));
}

/** The last assignment of a name is the one the readers keep. */
export function envValues(entries: EnvEntry[]): Map<string, string> {
  return new Map(entries.map(({ key, value }) => [key, value]));
}

/**
 * `${NAME}` stays a reference to another variable. Any other `$` is written as a literal,
 * since a password holding one would otherwise be expanded, or run as `$(command)`.
 */
function encodeValue(value: string, style: Quote): string {
  if (style === "'" && !/['\r\n]/.test(value)) return `'${value}'`;
  if (style === null && SAFE_UNQUOTED.test(value)) return value;
  const escaped = value.replace(/\\|"|\n|\r|\$(?!\{[A-Za-z_][^}]*\})/g, (character) =>
    character === "\n" ? "\\n" : character === "\r" ? "\\r" : `\\${character}`,
  );
  return `"${escaped}"`;
}

/**
 * Sets a variable, or removes it with `null`. Comments, order and every other line stay as
 * they are. Null if the result would not read back as asked: the file is then left alone.
 */
export function writeEnvValue(content: string, key: string, value: string | null): string | null {
  const before = parseVariables(content);
  const targets = before.filter((variable) => variable.key === key);
  const last = targets.at(-1);

  let next: string;
  if (value === null) {
    next = targets.reduceRight(
      (text, target) => text.slice(0, target.lineStart) + text.slice(target.nextLine),
      content,
    );
  } else if (last) {
    next = content.slice(0, last.valueStart) + encodeValue(value, last.quote) + content.slice(last.valueEnd);
  } else {
    const lineBreak = content.includes("\r\n") ? "\r\n" : "\n";
    const separator = content === "" || /[\r\n]$/.test(content) ? "" : lineBreak;
    next = `${content}${separator}${key}=${encodeValue(value, null)}${lineBreak}`;
  }

  const expected = envValues(before);
  if (value === null) expected.delete(key);
  else expected.set(key, value);
  const actual = envValues(parseEnv(next));
  if (actual.size !== expected.size) return null;
  for (const [name, text] of expected) {
    if (actual.get(name) !== text) return null;
  }
  return next;
}

export type EnvRowState = "missing" | "different" | "same" | "extra" | "removed";

export type EnvRow = {
  key: string;
  /** Null when the file does not have it. */
  declared: string | null;
  local: string | null;
  state: EnvRowState;
};

/**
 * In the order of the declarations, then what only the local file has, then what is
 * left only in the history, which is where such a variable can be brought back from.
 */
export function compareEnv(declared: EnvEntry[], local: EnvEntry[], inHistory: string[] = []): EnvRow[] {
  const declaredValues = envValues(declared);
  const localValues = envValues(local);
  const keys = new Set([...declaredValues.keys(), ...localValues.keys(), ...inHistory]);
  return [...keys].map((key) => {
    const inDeclared = declaredValues.get(key) ?? null;
    const inLocal = localValues.get(key) ?? null;
    const state: EnvRowState =
      inDeclared === null
        ? inLocal === null
          ? "removed"
          : "extra"
        : inLocal === null
          ? "missing"
          : inLocal === inDeclared
            ? "same"
            : "different";
    return { key, declared: inDeclared, local: inLocal, state };
  });
}
