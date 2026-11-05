import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createLineSplitter, type LogEvent, type LogStreamName, MAX_LINE_LENGTH, parseLogLine } from "@/lib/container-logs";

/** Enough to see what led to now, on top of which the lines arrive as they are written. */
export const LOG_TAIL = 1000;

/** A stopped container is looked at again this often, for as long as the panel is open. */
export const LOG_RESUME_MS = 3000;
/** Each container's share when several are shown together. */
export const MERGED_LOG_TAIL = 500;

type LogProcess = ChildProcessByStdio<null, Readable, Readable>;

/** `--` is there for form: the id has already been found among the project's containers. */
export const logArgs = (containerId: string, tail = LOG_TAIL, since?: string) => [
  "logs",
  "--follow",
  "--timestamps",
  ...(since ? ["--since", since] : ["--tail", String(tail)]),
  "--",
  containerId,
];

const spawnDocker = (containerId: string, tail: number, since?: string): LogProcess =>
  spawn("docker", logArgs(containerId, tail, since), { stdio: ["ignore", "pipe", "pipe"] });

type LogOptions = {
  signal?: AbortSignal;
  start?: (containerId: string, tail: number, since?: string) => LogProcess;
  tail?: number;
  /** Set to follow a container across a stop: how long to wait before looking at it again. */
  resumeMs?: number;
};

/**
 * What a container writes, as NDJSON, for as long as someone reads it and nothing is kept.
 * `docker logs` gives the container's stderr on its own stderr, so its own errors arrive there too.
 * A reader that slows down holds the process back, and one that leaves ends it.
 */
export function streamContainerLogs(
  containerId: string,
  { signal, start = spawnDocker, tail = LOG_TAIL, resumeMs }: LogOptions = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let child: LogProcess | undefined;
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const stop = () => {
    closed = true;
    clearTimeout(timer);
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

      let lastTime: string | undefined;
      let waiting = false;

      const follow = () => {
        // Docker's `--since` includes that very moment: what was already sent is left out.
        const since = lastTime;
        const docker = start(containerId, tail, since);
        child = docker;
        const flushers = (["out", "err"] as const).map((stream: LogStreamName) => {
          const source = stream === "out" ? docker.stdout : docker.stderr;
          const decoder = new StringDecoder("utf8");
          const splitter = createLineSplitter(MAX_LINE_LENGTH);
          const toEvents = (lines: string[]): LogEvent[] => {
            const events: LogEvent[] = [];
            for (const line of lines) {
              const { time } = parseLogLine(line);
              if (time && since && time <= since) continue;
              if (time && (!lastTime || time > lastTime)) lastTime = time;
              events.push({ stream, line: line.slice(0, MAX_LINE_LENGTH) });
            }
            if (waiting && events.length > 0) {
              waiting = false;
              events.unshift({ waiting: false });
            }
            return events;
          };
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
          // A failure is a container that is gone, or a daemon that is: nothing to wait for.
          if (resumeMs === undefined || code !== 0) return finish(code);
          if (closed) return;
          if (!waiting) {
            waiting = true;
            send([{ waiting: true }]);
          }
          timer = setTimeout(follow, resumeMs);
        });
      };
      follow();
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

/**
 * Several containers as one stream, each line saying whose it is. Nothing here orders them:
 * they carry Docker's dates, which the reader sorts by. It ends with the last of them.
 */
export function mergeLogStreams(sources: { name: string; stream: ReadableStream<Uint8Array> }[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const readers = sources.map(({ stream }) => stream.getReader());
  const stopped = new Set<number>();
  let waiters: (() => void)[] = [];
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let remaining = sources.length;
      let worst: number | null = 0;
      let lastWaiting = false;
      const send = (events: LogEvent[]) => {
        if (!cancelled && events.length > 0) {
          controller.enqueue(encoder.encode(events.map((event) => `${JSON.stringify(event)}\n`).join("")));
        }
      };
      const updateWaiting = () => {
        const waiting = stopped.size > 0 && stopped.size === remaining;
        if (waiting !== lastWaiting) {
          lastWaiting = waiting;
          send([{ waiting }]);
        }
      };
      if (remaining === 0) {
        send([{ end: true, code: 0 }]);
        controller.close();
        return;
      }

      sources.forEach(({ name }, index) => {
        void (async () => {
          const decoder = new TextDecoder();
          const splitter = createLineSplitter();
          try {
            for (;;) {
              while (!cancelled && (controller.desiredSize ?? 1) <= 0) await new Promise<void>((resolve) => waiters.push(resolve));
              const { done, value } = await readers[index].read();
              if (done || cancelled) break;
              const events: LogEvent[] = [];
              for (const line of splitter.push(decoder.decode(value, { stream: true }))) {
                if (!line) continue;
                const event = JSON.parse(line) as LogEvent;
                if ("end" in event) {
                  if (event.code !== 0) worst = event.code;
                } else if ("waiting" in event) {
                  if (event.waiting) stopped.add(index);
                  else stopped.delete(index);
                } else {
                  events.push({ ...event, source: name });
                }
              }
              send(events);
              updateWaiting();
            }
          } catch {
            // The reader left: the others are being cancelled with it.
          }
          stopped.delete(index);
          remaining -= 1;
          if (remaining === 0 && !cancelled) {
            send([{ end: true, code: worst }]);
            controller.close();
          } else {
            updateWaiting();
          }
        })();
      });
    },
    pull() {
      const woken = waiters;
      waiters = [];
      for (const wake of woken) wake();
    },
    cancel() {
      cancelled = true;
      const woken = waiters;
      waiters = [];
      for (const wake of woken) wake();
      for (const reader of readers) void reader.cancel().catch(() => undefined);
    },
  });
}
