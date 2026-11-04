import { describe, expect, it } from "vitest";
import { mayHoldCall, parseTranscriptLine, projectForCwd } from "./transcript-line";

const assistantLine = (overrides: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "assistant",
    sessionId: "session-1",
    cwd: "/work/app",
    timestamp: "2026-11-04T21:14:03.341Z",
    isSidechain: false,
    message: {
      id: "msg_1",
      model: "claude-opus-5-5",
      usage: {
        input_tokens: 2,
        output_tokens: 517,
        cache_read_input_tokens: 25271,
        cache_creation_input_tokens: 13009,
        cache_creation: { ephemeral_1h_input_tokens: 13000, ephemeral_5m_input_tokens: 9 },
        server_tool_use: { web_search_requests: 3 },
        speed: "standard",
        ...usage,
      },
    },
    ...overrides,
  });

const call = (line: string) => {
  const parsed = parseTranscriptLine(line);
  if (parsed.kind !== "call") throw new Error(`expected a call, got ${parsed.kind}`);
  return parsed.call;
};

describe("parseTranscriptLine", () => {
  it("reads the figures of a call", () => {
    expect(call(assistantLine())).toEqual({
      messageId: "msg_1",
      sessionId: "session-1",
      cwd: "/work/app",
      calledAt: new Date("2026-11-04T21:14:03.341Z"),
      model: "claude-opus-5-5",
      isSidechain: false,
      inputTokens: 2,
      outputTokens: 517,
      cacheReadTokens: 25271,
      cacheWrite5mTokens: 9,
      cacheWrite1hTokens: 13000,
      webSearchRequests: 3,
      speed: "standard",
    });
  });

  it("tells the calls of a subagent", () => {
    expect(call(assistantLine({ isSidechain: true })).isSidechain).toBe(true);
  });

  it("takes cache writes with no breakdown for the 5-minute kind", () => {
    const { cacheWrite5mTokens, cacheWrite1hTokens } = call(assistantLine({}, { cache_creation: undefined }));
    expect({ cacheWrite5mTokens, cacheWrite1hTokens }).toEqual({ cacheWrite5mTokens: 13009, cacheWrite1hTokens: 0 });
  });

  it("does not need the fields that are not essential", () => {
    const parsed = call(assistantLine({}, { server_tool_use: undefined, speed: undefined }));
    expect(parsed.webSearchRequests).toBe(0);
    expect(parsed.speed).toBeNull();
  });

  it("ignores the lines that are not calls", () => {
    expect(parseTranscriptLine(JSON.stringify({ type: "user", message: { role: "assistant" } }))).toEqual({
      kind: "ignored",
    });
  });

  it.each([
    ["broken JSON", '{"type":"assistant"'],
    ["no usage", JSON.stringify({ type: "assistant", message: { id: "m", model: "x" } })],
    ["no folder", assistantLine({ cwd: undefined })],
    ["a bad date", assistantLine({ timestamp: "yesterday" })],
    ["a count that is not one", assistantLine({}, { output_tokens: "517" })],
    ["a negative count", assistantLine({}, { input_tokens: -1 })],
  ])("reports %s rather than counting nothing", (_name, line) => {
    expect(parseTranscriptLine(line)).toEqual({ kind: "unreadable" });
  });
});

describe("mayHoldCall", () => {
  it("lets through an assistant line, and not a mention of the word in text", () => {
    expect(mayHoldCall(Buffer.from(assistantLine()))).toBe(true);
    expect(mayHoldCall(Buffer.from(JSON.stringify({ type: "user", text: 'said "assistant"' })))).toBe(false);
  });
});

describe("projectForCwd", () => {
  const projects = [
    { id: 1, path: "/work/app" },
    { id: 2, path: "/work/app/packages/api" },
    { id: 3, path: "/work/app-old" },
  ];

  it("finds the project of its own folder and of those below", () => {
    expect(projectForCwd("/work/app", projects)).toBe(1);
    expect(projectForCwd("/work/app/src", projects)).toBe(1);
  });

  it("prefers the deepest project", () => {
    expect(projectForCwd("/work/app/packages/api/src", projects)).toBe(2);
  });

  it("is not fooled by a folder whose name merely starts the same", () => {
    expect(projectForCwd("/work/app-old/src", projects)).toBe(3);
    expect(projectForCwd("/work/application", projects)).toBeNull();
  });

  it("finds nothing above a project", () => {
    expect(projectForCwd("/work", projects)).toBeNull();
  });
});
