/** Pure helpers of the Tools page: everything runs in the browser, nothing is sent or kept. */

export type RandomSource = (count: number) => Uint32Array;
export const cryptoRandom: RandomSource = (count) => crypto.getRandomValues(new Uint32Array(count));

const CLASSES = {
  lower: "abcdefghijkmnopqrstuvwxyz",
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  digits: "23456789",
  symbols: "!#$%&()*+,-./:;<=>?@[]^_{|}~",
} as const;
/** Characters easy to mistake for one another, kept only when asked. */
const AMBIGUOUS = { lower: "l", upper: "IO", digits: "01", symbols: "" } as const;

export type PasswordClass = keyof typeof CLASSES;
export type PasswordOptions = { length: number; classes: PasswordClass[]; ambiguous: boolean };

/** Uniform: values above the last whole multiple of the alphabet are drawn again. */
function pick(alphabet: string, random: RandomSource): string {
  const limit = Math.floor(0x1_0000_0000 / alphabet.length) * alphabet.length;
  for (;;) {
    const [value] = random(1);
    if (value < limit) return alphabet[value % alphabet.length];
  }
}

/** At least one character of each class asked, at places drawn too. */
export function generatePassword({ length, classes, ambiguous }: PasswordOptions, random: RandomSource = cryptoRandom): string {
  const chosen = classes.length > 0 ? classes : (["lower"] as PasswordClass[]);
  const alphabets = chosen.map((name) => CLASSES[name] + (ambiguous ? AMBIGUOUS[name] : ""));
  const size = Math.max(length, chosen.length, 4);
  const all = alphabets.join("");
  const characters = [...alphabets.map((alphabet) => pick(alphabet, random)), ...Array.from({ length: size - chosen.length }, () => pick(all, random))];
  // Fisher–Yates, so that the first characters are not always one per class.
  for (let index = characters.length - 1; index > 0; index--) {
    const other = Number(random(1)[0] % (index + 1));
    [characters[index], characters[other]] = [characters[other], characters[index]];
  }
  return characters.join("");
}

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const dashed = (text: string) => `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;

/** Version 4, from 16 random bytes: `crypto.randomUUID` exists only on https or localhost. */
export function uuidV4(randomBytes: Uint8Array): string {
  const bytes = Uint8Array.from(randomBytes.subarray(0, 16));
  bytes[6] = 0x40 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  return dashed(hex(bytes));
}

/** Version 7: ordered by time, which databases index better than version 4. */
export function uuidV7(now: number, randomBytes: Uint8Array): string {
  const bytes = new Uint8Array(16);
  bytes.set(randomBytes.subarray(0, 10), 6);
  let time = now;
  for (let index = 5; index >= 0; index--) {
    bytes[index] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  return dashed(hex(bytes));
}

/** UTF-8 both ways; null when the text is not base64, or not text once decoded. */
export function encodeBase64(text: string, urlSafe = false): string {
  const binary = String.fromCharCode(...new TextEncoder().encode(text));
  const encoded = btoa(binary);
  return urlSafe ? encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") : encoded;
}

export function decodeBase64(text: string): string | null {
  const clean = text.trim().replace(/\s+/g, "").replaceAll("-", "+").replaceAll("_", "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  try {
    const binary = atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, "="));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

export type DecodedJwt = {
  header: unknown;
  payload: unknown;
  /** The registered dates, when present, in ms. */
  times: { name: "exp" | "iat" | "nbf"; at: number }[];
  expired: boolean | null;
};

/** Read, never verified: the signature needs a key this page does not have. */
export function decodeJwt(token: string, now: number): DecodedJwt | null {
  const parts = token.trim().replace(/^Bearer\s+/i, "").split(".");
  if (parts.length !== 3) return null;
  const read = (part: string) => {
    const text = decodeBase64(part);
    if (text === null) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  };
  const header = read(parts[0]);
  const payload = read(parts[1]);
  if (header === undefined || payload === undefined) return null;
  const claims = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const times = (["exp", "iat", "nbf"] as const).flatMap((name) => (typeof claims[name] === "number" ? [{ name, at: (claims[name] as number) * 1000 }] : []));
  const exp = times.find(({ name }) => name === "exp");
  return { header, payload, times, expired: exp ? exp.at <= now : null };
}

export type JsonResult = { output: string } | { error: string; line: number | null; column: number | null };

/** `indent` 0 writes it on one line. */
export function formatJson(text: string, indent: number): JsonResult {
  try {
    return { output: JSON.stringify(JSON.parse(text), null, indent) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const position = /position (\d+)/.exec(message)?.[1];
    if (position === undefined) {
      const at = /line (\d+) column (\d+)/.exec(message);
      return { error: message, line: at ? Number(at[1]) : null, column: at ? Number(at[2]) : null };
    }
    const before = text.slice(0, Number(position)).split("\n");
    return { error: message, line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
  }
}

/**
 * A number is seconds up to the year 5138, ms beyond (13 digits today); anything else is read
 * as a date, such as an ISO string.
 */
export function readTimestamp(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const value = Number(text);
    return Math.abs(value) < 1e11 ? value * 1000 : value;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

// Cron, the five fields of crontab.

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

export type CronFieldName = "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek";
const FIELDS: { name: CronFieldName; min: number; max: number; names?: string[]; offset?: number }[] = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dayOfMonth", min: 1, max: 31 },
  { name: "month", min: 1, max: 12, names: MONTHS, offset: 1 },
  { name: "dayOfWeek", min: 0, max: 7, names: DAYS, offset: 0 },
];

/** How a field reads: every value, every n from the start, or the values listed. */
export type CronField = { kind: "all" } | { kind: "every"; step: number } | { kind: "list"; values: number[] };
export type Cron = { fields: Record<CronFieldName, CronField>; sets: Record<CronFieldName, Set<number>> };
export type CronProblem = { field: CronFieldName | null; text: string };

export function parseCron(expression: string): Cron | CronProblem {
  const text = MACROS[expression.trim().toLowerCase()] ?? expression.trim();
  const parts = text.split(/\s+/);
  if (parts.length !== 5) return { field: null, text };
  const fields = {} as Record<CronFieldName, CronField>;
  const sets = {} as Record<CronFieldName, Set<number>>;
  for (const [index, spec] of FIELDS.entries()) {
    const part = parts[index];
    const value = (token: string) => {
      const named = spec.names?.indexOf(token.toUpperCase()) ?? -1;
      return named >= 0 ? named + (spec.offset ?? 0) : /^\d+$/.test(token) ? Number(token) : NaN;
    };
    const set = new Set<number>();
    for (const item of part.split(",")) {
      const [range, stepText] = item.split("/");
      const step = stepText === undefined ? 1 : Number(stepText);
      const [startText, endText] = range.split("-");
      const start = range === "*" ? spec.min : value(startText);
      const end = range === "*" ? spec.max : endText === undefined ? (stepText === undefined ? start : spec.max) : value(endText);
      if (![start, end, step].every(Number.isInteger) || step < 1 || start < spec.min || end > spec.max || start > end) return { field: spec.name, text: part };
      for (let current = start; current <= end; current += step) set.add(spec.name === "dayOfWeek" && current === 7 ? 0 : current);
    }
    sets[spec.name] = set;
    const every = /^\*\/(\d+)$/.exec(part);
    fields[spec.name] = part === "*" ? { kind: "all" } : every ? { kind: "every", step: Number(every[1]) } : { kind: "list", values: [...set].sort((a, b) => a - b) };
  }
  return { fields, sets };
}

/** As cron does: with both days restricted, either one is enough. */
function dayMatches(cron: Cron, date: Date): boolean {
  const { dayOfMonth, dayOfWeek } = cron.fields;
  const byMonth = cron.sets.dayOfMonth.has(date.getDate());
  const byWeek = cron.sets.dayOfWeek.has(date.getDay());
  if (dayOfMonth.kind === "all") return byWeek;
  if (dayOfWeek.kind === "all") return byMonth;
  return byMonth || byWeek;
}

/** The next times, in the zone of the browser, looked for over five years at most. */
export function nextRuns(cron: Cron, from: number, count: number): number[] {
  const runs: number[] = [];
  const minutes = [...cron.sets.minute].sort((a, b) => a - b);
  const hours = [...cron.sets.hour].sort((a, b) => a - b);
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  for (let days = 0; days < 366 * 5 && runs.length < count; days++, day.setDate(day.getDate() + 1)) {
    if (!cron.sets.month.has(day.getMonth() + 1) || !dayMatches(cron, day)) continue;
    for (const hour of hours) {
      for (const minute of minutes) {
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime();
        if (at > from && runs.length < count) runs.push(at);
      }
    }
  }
  return runs;
}
