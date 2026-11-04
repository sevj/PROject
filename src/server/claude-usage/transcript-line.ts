/** One call to the API, as told by a line of a transcript. */
export type ApiCall = {
  messageId: string;
  sessionId: string;
  cwd: string;
  calledAt: Date;
  model: string;
  isSidechain: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  webSearchRequests: number;
  speed: string | null;
};

export type ParsedLine = { kind: "call"; call: ApiCall } | { kind: "ignored" } | { kind: "unreadable" };

const IGNORED: ParsedLine = { kind: "ignored" };
const UNREADABLE: ParsedLine = { kind: "unreadable" };
const ASSISTANT = Buffer.from('"assistant"');

/**
 * Most of the weight of a transcript is in lines that hold no call, some of them megabytes
 * long. Text that merely mentions the word has its quotes escaped, so it does not match.
 */
export const mayHoldCall = (line: Buffer): boolean => line.includes(ASSISTANT);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

const optionalCount = (value: unknown): number => (isCount(value) ? value : 0);

/**
 * The format is internal to Claude Code and can change with any version: what is not
 * known is left alone, and an assistant line without its figures is reported rather than
 * counted as nothing, so that a change of format shows.
 */
export function parseTranscriptLine(line: string): ParsedLine {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return UNREADABLE;
  }
  if (!isRecord(entry) || entry.type !== "assistant") return IGNORED;

  const { message, sessionId, cwd, timestamp } = entry;
  if (!isRecord(message) || !isRecord(message.usage)) return UNREADABLE;
  const { id, model, usage } = message as { id: unknown; model: unknown; usage: Record<string, unknown> };
  if (typeof id !== "string" || typeof model !== "string") return UNREADABLE;
  if (typeof sessionId !== "string" || typeof cwd !== "string" || typeof timestamp !== "string") return UNREADABLE;

  const calledAt = new Date(timestamp);
  if (Number.isNaN(calledAt.getTime())) return UNREADABLE;

  const {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_input_tokens: cacheWriteTokens,
  } = usage;
  if (!isCount(inputTokens) || !isCount(outputTokens) || !isCount(cacheReadTokens) || !isCount(cacheWriteTokens)) {
    return UNREADABLE;
  }

  // The total is what is certain. Without a breakdown, the writes are of the older, 5-minute kind.
  const breakdown = isRecord(usage.cache_creation) ? usage.cache_creation : {};
  const cacheWrite1hTokens = Math.min(optionalCount(breakdown.ephemeral_1h_input_tokens), cacheWriteTokens);
  const serverTools = isRecord(usage.server_tool_use) ? usage.server_tool_use : {};

  return {
    kind: "call",
    call: {
      messageId: id,
      sessionId,
      cwd,
      calledAt,
      model,
      isSidechain: entry.isSidechain === true,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWrite5mTokens: cacheWriteTokens - cacheWrite1hTokens,
      cacheWrite1hTokens,
      webSearchRequests: optionalCount(serverTools.web_search_requests),
      speed: typeof usage.speed === "string" ? usage.speed : null,
    },
  };
}

/** The deepest registered folder holding `cwd`, so that a sub-project wins over its parent. */
export function projectForCwd(cwd: string, projects: readonly { id: number; path: string }[]): number | null {
  let best: { id: number; path: string } | null = null;
  for (const project of projects) {
    const holds = cwd === project.path || cwd.startsWith(`${project.path}/`);
    if (holds && (!best || project.path.length > best.path.length)) best = project;
  }
  return best?.id ?? null;
}
