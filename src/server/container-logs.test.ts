import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { LogEvent } from "@/lib/container-logs";
import { logArgs, mergeLogStreams, streamContainerLogs } from "./container-logs";

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

describe("logArgs with a date", () => {
  it("reads from that moment instead of the last lines", () => {
    expect(logArgs("abc", 10, "2026-01-01T00:00:00Z")).toEqual(["logs", "--follow", "--timestamps", "--since", "2026-01-01T00:00:00Z", "--", "abc"]);
  });
});

const T1 = "2026-01-01T00:00:01.000000000Z";
const T2 = "2026-01-01T00:00:02.000000000Z";

describe("following a container across a stop", () => {
  it("says it waits, leaves out what was sent, and ends when the container is gone", async () => {
    const calls: (string | undefined)[] = [];
    const scripts = [`echo '${T1} first'`, "exit 0", `echo '${T1} first'; echo '${T2} second'`, "echo gone >&2; exit 1"];
    const events = await readAll(
      streamContainerLogs("id", {
        resumeMs: 1,
        start: (_id, _tail, since) => {
          calls.push(since);
          return shell(scripts[calls.length - 1])();
        },
      }),
    );
    expect(calls).toEqual([undefined, T1, T1, T2]);
    expect(events).toEqual([
      { stream: "out", line: `${T1} first` },
      { waiting: true },
      { waiting: false },
      { stream: "out", line: `${T2} second` },
      { waiting: true },
      { waiting: false },
      { stream: "err", line: "gone" },
      { end: true, code: 1 },
    ]);
  });

  it("stops looking when the reader leaves", async () => {
    let starts = 0;
    const reader = streamContainerLogs("id", {
      resumeMs: 1,
      start: () => {
        starts += 1;
        return shell("exit 0")();
      },
    }).getReader();
    await reader.read();
    await reader.cancel();
    const seen = starts;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(starts).toBe(seen);
  });
});

describe("mergeLogStreams", () => {
  const source = (name: string, script: string, resumeMs?: number) => ({
    name,
    stream: streamContainerLogs(name, { start: shell(script), resumeMs }),
  });

  it("names the container of each line, and ends once, after the last one", async () => {
    const events = await readAll(mergeLogStreams([source("web", "echo a"), source("db", "sleep 0.05; echo b >&2; exit 2")]));
    expect(events).toContainEqual({ stream: "out", line: "a", source: "web" });
    expect(events).toContainEqual({ stream: "err", line: "b", source: "db" });
    expect(events.filter((event) => "end" in event)).toEqual([{ end: true, code: 2 }]);
    expect(events.at(-1)).toEqual({ end: true, code: 2 });
  });

  it("waits only when all of them do, and ends all of them when the reader leaves", async () => {
    const reader = mergeLogStreams([source("web", "exit 0", 5), source("db", "exit 0", 5)]).getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain('"waiting":true');
    await reader.cancel();
  });

  it("has nothing to say about no container", async () => {
    expect(await readAll(mergeLogStreams([]))).toEqual([{ end: true, code: 0 }]);
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
