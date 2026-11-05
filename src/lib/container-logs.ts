export type LogStreamName = "out" | "err";

/** One line of NDJSON each: the lines as Docker gives them, then how it ended. */
export type LogEvent =
  /** `source` names the container, when several are followed together. */
  | { stream: LogStreamName; line: string; source?: string }
  /** Its container has stopped, and is watched until it starts again. */
  | { waiting: boolean }
  | { end: true; code: number | null; error?: string };

export type LogLine = { time: string | null; text: string };

/** What is kept of a line that never ends, such as a program writing a progress bar forever. */
export const MAX_LINE_LENGTH = 64 * 1024;

/**
 * Text comes in pieces that do not stop at line ends: `push` gives the lines completed so far,
 * and `flush` what is left when no more will come.
 */
export function createLineSplitter(maxLength = Number.POSITIVE_INFINITY) {
  let rest = "";
  return {
    push(text: string): string[] {
      const parts = (rest + text).split("\n");
      rest = parts.pop() ?? "";
      if (rest.length > maxLength) {
        parts.push(rest);
        rest = "";
      }
      return parts;
    },
    flush(): string[] {
      const last = rest;
      rest = "";
      return last === "" ? [] : [last];
    },
  };
}

// Colors, cursor moves and titles: a program talking to a terminal, which this view is not.
const ESCAPES = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\^_])/g;
// Everything else below the space, tabs excepted.
const CONTROLS = /[\u0000-\u0008\u000a-\u001f\u007f]/g;

export function cleanLogText(text: string): string {
  return text.replace(ESCAPES, "").replace(CONTROLS, "");
}

/** `docker logs --timestamps` starts each line with its date, then one space. */
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})) ?/;

export function parseLogLine(raw: string): LogLine {
  const match = TIMESTAMP.exec(raw);
  return match
    ? { time: match[1], text: cleanLogText(raw.slice(match[0].length)) }
    : { time: null, text: cleanLogText(raw) };
}

/**
 * stdout and stderr come through separate pipes, so a batch of one can arrive after later lines
 * of the other: Docker's dates give the real order. They all have nine decimals, so they compare
 * as text. `at` is the line's date, or the one before it for a line without one, and lines with
 * the same date stay in the order they came, which the stable sort guarantees.
 */
export function mergeLogRows<Row extends { at: string }>(current: Row[], added: Row[], max: number): Row[] {
  const merged = [...current, ...added];
  const ordered = merged.every((row, index) => index === 0 || merged[index - 1].at <= row.at);
  if (!ordered) merged.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return merged.slice(-max);
}

/** In the reader's time zone, to the second: the day matters for a container that has lived long. */
export function formatLogTime(time: string): string {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return time;
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}
