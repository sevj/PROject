import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createLineSplitter, type LogEvent, type LogStreamName, MAX_LINE_LENGTH } from "@/lib/container-logs";

/** Enough to see what led to now, on top of which the lines arrive as they are written. */
export const LOG_TAIL = 1000;

type LogProcess = ChildProcessByStdio<null, Readable, Readable>;

/** `--` is there for form: the id has already been found among the project's containers. */
export const logArgs = (containerId: string, tail = LOG_TAIL) => [
  "logs",
  "--follow",
  "--timestamps",
  "--tail",
  String(tail),
  "--",
  containerId,
];

const spawnDocker = (containerId: string): LogProcess =>
  spawn("docker", logArgs(containerId), { stdio: ["ignore", "pipe", "pipe"] });

/**
 * What a container writes, as NDJSON, for as long as someone reads it and nothing is kept.
 * `docker logs` gives the container's stderr on its own stderr, so its own errors arrive there too.
 * A reader that slows down holds the process back, and one that leaves ends it.
 */
export function streamContainerLogs(
  containerId: string,
  { signal, start = spawnDocker }: { signal?: AbortSignal; start?: (containerId: string) => LogProcess } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let child: LogProcess | undefined;
  let closed = false;

  const stop = () => {
    closed = true;
    signal?.removeEventListener("abort", onAbort);
    child?.stdout.destroy();
    child?.stderr.destroy();
    child?.kill();
  };
  let onAbort = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (signal?.aborted) {
        closed = true;
        controller.close();
        return;
      }
      onAbort = () => {
        if (closed) return;
        stop();
        controller.close();
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const send = (events: LogEvent[]) => {
        if (closed || events.length === 0) return;
        controller.enqueue(encoder.encode(events.map((event) => `${JSON.stringify(event)}\n`).join("")));
      };
      const finish = (code: number | null, error?: string) => {
        if (closed) return;
        send([{ end: true, code, ...(error ? { error } : {}) }]);
        stop();
        controller.close();
      };

      const docker = start(containerId);
      child = docker;
      const flushers = (["out", "err"] as const).map((stream: LogStreamName) => {
        const source = stream === "out" ? docker.stdout : docker.stderr;
        const decoder = new StringDecoder("utf8");
        const splitter = createLineSplitter(MAX_LINE_LENGTH);
        const toEvents = (lines: string[]) => lines.map((line) => ({ stream, line: line.slice(0, MAX_LINE_LENGTH) }));
        source.on("data", (chunk: Buffer) => {
          send(toEvents(splitter.push(decoder.write(chunk))));
          if ((controller.desiredSize ?? 1) <= 0) {
            docker.stdout.pause();
            docker.stderr.pause();
          }
        });
        source.on("error", () => undefined);
        return () => send(toEvents([...splitter.push(decoder.end()), ...splitter.flush()]));
      });

      docker.on("error", (error) => finish(null, error.message));
      docker.on("close", (code) => {
        for (const flush of flushers) flush();
        finish(code);
      });
    },
    pull() {
      child?.stdout.resume();
      child?.stderr.resume();
    },
    cancel() {
      stop();
    },
  });
}
