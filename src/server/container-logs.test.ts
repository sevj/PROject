import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { LogEvent } from "@/lib/container-logs";
import { logArgs, streamContainerLogs } from "./container-logs";

const shell = (script: string) => () => spawn("sh", ["-c", script], { stdio: ["ignore", "pipe", "pipe"] });

async function readAll(stream: ReadableStream<Uint8Array>): Promise<LogEvent[]> {
  const text = await new Response(stream).text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEvent);
}

describe("logArgs", () => {
  it("follows from the last lines, with dates", () => {
    expect(logArgs("abc", 10)).toEqual(["logs", "--follow", "--timestamps", "--tail", "10", "--", "abc"]);
  });
});

describe("streamContainerLogs", () => {
  it("tells stdout from stderr, then how it ended", async () => {
    const events = await readAll(
      streamContainerLogs("id", { start: shell("echo out; echo err >&2; printf 'no end'; exit 3") }),
    );
    expect(events).toContainEqual({ stream: "out", line: "out" });
    expect(events).toContainEqual({ stream: "err", line: "err" });
    expect(events).toContainEqual({ stream: "out", line: "no end" });
    expect(events.at(-1)).toEqual({ end: true, code: 3 });
  });

  it("does not break a character cut between two pieces", async () => {
    const events = await readAll(
      streamContainerLogs("id", { start: shell("printf '\\303'; sleep 0.1; printf '\\251\\n'") }),
    );
    expect(events).toContainEqual({ stream: "out", line: "é" });
  });

  it("says so when docker cannot be run", async () => {
    const events = await readAll(
      streamContainerLogs("id", {
        start: () => spawn("/nonexistent/docker", [], { stdio: ["ignore", "pipe", "pipe"] }),
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ end: true, code: null, error: expect.stringContaining("ENOENT") });
  });

  it("ends the process when the reader leaves", async () => {
    const child = shell("echo first; exec sleep 30")();
    const closed = new Promise((resolve) => child.on("close", resolve));
    const reader = streamContainerLogs("id", { start: () => child }).getReader();
    await reader.read();
    await reader.cancel();
    await closed;
    expect(child.killed).toBe(true);
  });

  it("ends the process when the request is aborted", async () => {
    const child = shell("echo first; exec sleep 30")();
    const closed = new Promise((resolve) => child.on("close", resolve));
    const abort = new AbortController();
    const reader = streamContainerLogs("id", { signal: abort.signal, start: () => child }).getReader();
    await reader.read();
    abort.abort();
    await closed;
    expect(child.killed).toBe(true);
  });

  it("holds the process back for a slow reader without losing anything", async () => {
    const events = await readAll(
      streamContainerLogs("id", { start: shell("i=0; while [ $i -lt 2000 ]; do echo line$i; i=$((i+1)); done") }),
    );
    const lines = events.flatMap((event) => ("line" in event ? [event.line] : []));
    expect(lines).toHaveLength(2000);
    expect(lines.at(-1)).toBe("line1999");
  });
});
