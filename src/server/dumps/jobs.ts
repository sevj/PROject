import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { type Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { type Engine, isValidDatabaseName } from "@/lib/db-engines";
import { dockerSocketPath } from "../console/docker-socket";
import { endSession } from "../console/docker-exec";
import type { Db } from "../db/client";
import { type ContainerInfo, execArgs, execEnv, runQuick } from "./docker-run";
import {
  type CredentialOverride,
  type Command,
  dumpCommand,
  ensureDatabaseCommand,
  estimateCommand,
  parseEstimate,
  readCredentials,
  restoreCommand,
} from "./engines";
import { createDump, type DumpRecord, dumpPath, failStaleDumps, finishDump, stashDir } from "./store";

export type JobError = "busy" | "limit" | "invalidDatabase" | "fileMissing" | "notFinished";

export type JobView = {
  id: string;
  kind: "dump" | "restore";
  status: "running" | "done" | "failed" | "cancelled";
  dumpId: number;
  projectName: string;
  containerName: string;
  engine: Engine;
  database: string | null;
  /** Bytes read so far: from the database for a dump, from the file for a load. */
  processedBytes: number;
  /** What it will come to. For a dump, only an estimate, and none when it proved wrong. */
  totalBytes: number | null;
  estimated: boolean;
  outputBytes: number;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  /** Statements the server refused while loading, which it went on past. */
  warnings: number;
  detail: string | null;
};

export type JobTarget = {
  id: string;
  name: string;
  engine: Engine;
  projectId: number | null;
  projectName: string;
  info: ContainerInfo;
};

type Live = { job: JobView; containerId: string; cancel: () => void };

// Kept on globalThis so that a hot reload in dev does not lose a running job.
const holder = globalThis as unknown as { __pmDumpJobs?: Map<string, Live> };
const live = () => (holder.__pmDumpJobs ??= new Map());

const MAX_JOBS = 4;
const KEEP_FINISHED_MS = 60 * 60 * 1000;

export function listJobs(): JobView[] {
  const now = Date.now();
  for (const [id, { job }] of live()) {
    if (job.finishedAt !== null && now - job.finishedAt > KEEP_FINISHED_MS) live().delete(id);
  }
  return [...live().values()].map(({ job }) => ({ ...job })).sort((a, b) => b.startedAt - a.startedAt);
}

export function dismissJob(id: string): void {
  const entry = live().get(id);
  if (entry && entry.job.status !== "running") live().delete(id);
}

export function cancelJob(id: string): boolean {
  const entry = live().get(id);
  if (!entry || entry.job.status !== "running") return false;
  entry.cancel();
  return true;
}

function admit(containerId: string): JobError | null {
  const running = [...live().values()].filter(({ job }) => job.status === "running");
  if (running.some((entry) => entry.containerId === containerId)) return "busy";
  return running.length >= MAX_JOBS ? "limit" : null;
}

/** Counts what goes by without changing it. */
const counter = (onBytes: (bytes: number) => void) =>
  new Transform({
    transform(chunk: Buffer, _encoding, done) {
      onBytes(chunk.length);
      done(null, chunk);
    },
  });

const lastLines = (text: string, count = 6) => text.trim().split(/\r?\n/).filter(Boolean).slice(-count).join("\n");

function watch(stream: Readable | null, onLine?: (line: string) => void) {
  let text = "";
  let partial = "";
  stream?.on("data", (chunk: Buffer) => {
    text = (text + chunk.toString()).slice(-16_384);
    if (!onLine) return;
    const lines = (partial + chunk.toString()).split(/\r?\n/);
    partial = lines.pop() ?? "";
    lines.forEach(onLine);
  });
  return () => text;
}

function newJob(
  kind: JobView["kind"],
  dump: DumpRecord,
  target: JobTarget,
  totalBytes: number | null,
  estimated: boolean,
): JobView {
  return {
    id: randomBytes(8).toString("hex"),
    kind,
    status: "running",
    dumpId: dump.id,
    projectName: target.projectName,
    containerName: target.name,
    engine: target.engine,
    database: dump.database,
    processedBytes: 0,
    totalBytes,
    estimated,
    outputBytes: 0,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    warnings: 0,
    detail: null,
  };
}

function end(job: JobView, status: JobView["status"], error: string | null = null) {
  job.status = status;
  job.error = error;
  job.finishedAt = Date.now();
}

/**
 * Docker leaves the program running when the client that started it goes away, and has no
 * call to stop it: it is found again from inside the container, by the marker it was given.
 */
function stopInContainer(containerId: string, marker: string) {
  void dockerSocketPath()
    .then((socketPath) => endSession(socketPath, containerId, marker))
    .catch(() => undefined);
}

async function runDump(
  db: Db,
  entry: Live,
  record: DumpRecord,
  root: string,
  target: JobTarget,
  command: Command,
  estimate: Command,
) {
  const { job } = entry;
  const marker = `PM_JOB=${job.id}`;
  const file = dumpPath(root, record.fileName) ?? "";
  const part = `${file}.part`;
  const controller = new AbortController();
  let cancelled = false;
  let child: ChildProcess | undefined;
  // Asked for at any moment, even before the command has started.
  entry.cancel = () => {
    cancelled = true;
    controller.abort();
    if (child) {
      child.kill("SIGTERM");
      stopInContainer(target.id, marker);
    }
  };

  try {
    // Real data: the folders are for this user alone, like the files in them.
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    if (cancelled) {
      finishDump(db, record.id, { status: "cancelled" });
      end(job, "cancelled");
      return;
    }
    const started = spawn("docker", execArgs(target.id, command, marker), { env: execEnv(command), stdio: ["ignore", "pipe", "pipe"] });
    child = started;
    const stderr = watch(started.stderr);

    // The size is not known up front: it arrives when the database has said, if it does.
    void runQuick(target.id, estimate)
      .then(({ code, stdout }) => {
        const size = code === 0 ? parseEstimate(stdout) : null;
        if (size !== null && job.status === "running" && job.processedBytes <= size) {
          job.totalBytes = size;
          job.estimated = true;
        }
      })
      .catch(() => undefined);

    const closed = new Promise<number | null>((resolve) => {
      started.on("close", resolve);
      started.on("error", () => resolve(null));
    });
    const written = pipeline(
      started.stdout,
      counter((bytes) => {
        job.processedBytes += bytes;
        // The estimate was too low: a bar that is full while work goes on says nothing.
        if (job.estimated && job.totalBytes !== null && job.processedBytes > job.totalBytes) job.totalBytes = null;
      }),
      createGzip(),
      counter((bytes) => (job.outputBytes += bytes)),
      createWriteStream(part, { mode: 0o600 }),
      { signal: controller.signal },
    ).then(
      () => null,
      (error: Error) => error,
    );
    const [code, problem] = await Promise.all([closed, written]);

    if (cancelled) {
      await rm(part, { force: true });
      finishDump(db, record.id, { status: "cancelled" });
      end(job, "cancelled");
    } else if (code !== 0 || problem) {
      const message = lastLines(stderr()) || problem?.message || `The command stopped with code ${code}.`;
      await rm(part, { force: true });
      finishDump(db, record.id, { status: "failed", error: message });
      end(job, "failed", message);
    } else if (job.processedBytes === 0) {
      const message = lastLines(stderr()) || "The dump is empty.";
      await rm(part, { force: true });
      finishDump(db, record.id, { status: "failed", error: message });
      end(job, "failed", message);
    } else {
      await rename(part, file);
      const { size } = await stat(file);
      finishDump(db, record.id, { status: "done", sizeBytes: size, rawBytes: job.processedBytes });
      job.totalBytes = job.processedBytes;
      job.estimated = false;
      end(job, "done");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await rm(part, { force: true }).catch(() => undefined);
    finishDump(db, record.id, { status: "failed", error: message });
    end(job, "failed", message);
  }
}

async function runRestore(entry: Live, dump: DumpRecord, root: string, target: JobTarget, command: Command, ensure: Command | null) {
  const { job } = entry;
  const marker = `PM_JOB=${job.id}`;
  const controller = new AbortController();
  let cancelled = false;
  entry.cancel = () => {
    cancelled = true;
    controller.abort();
  };

  try {
    const file = dumpPath(root, dump.fileName) ?? "";
    job.totalBytes = (await stat(file)).size;
    job.estimated = false;

    if (ensure) {
      const result = await runQuick(target.id, ensure);
      if (result.code !== 0) throw new Error(lastLines(result.stderr) || "The database could not be created.");
    }
    if (cancelled) return end(job, "cancelled");

    const child = spawn("docker", execArgs(target.id, command, marker), { env: execEnv(command), stdio: ["pipe", "pipe", "pipe"] });
    if (cancelled) {
      child.kill("SIGTERM");
      return end(job, "cancelled");
    }
    child.stdout.resume();
    child.stdin.on("error", () => undefined);
    const stderr = watch(child.stderr, (line) => {
      if (/^(psql:.*:\d+: )?(ERROR|error)\b/.test(line)) job.warnings += 1;
    });
    entry.cancel = () => {
      cancelled = true;
      controller.abort();
      child.kill("SIGTERM");
      stopInContainer(target.id, marker);
    };

    const closed = new Promise<number | null>((resolve) => {
      child.on("close", resolve);
      child.on("error", () => resolve(null));
    });
    const read = pipeline(
      createReadStream(file),
      counter((bytes) => (job.processedBytes += bytes)),
      createGunzip(),
      child.stdin,
      { signal: controller.signal },
    ).then(
      () => null,
      (error: NodeJS.ErrnoException) => error,
    );
    const [code, problem] = await Promise.all([closed, read]);

    if (cancelled) return end(job, "cancelled");
    if (problem && /incorrect header|unexpected end of file|invalid/i.test(problem.message)) {
      throw new Error("The dump file is damaged or incomplete.");
    }
    if (code !== 0) throw new Error(lastLines(stderr()) || problem?.message || `The command stopped with code ${code}.`);
    job.processedBytes = job.totalBytes;
    job.detail = job.warnings > 0 ? lastLines(stderr(), 8) : null;
    end(job, "done");
  } catch (error) {
    end(job, "failed", error instanceof Error ? error.message : String(error));
  }
}

export function startDump(
  db: Db,
  input: {
    target: JobTarget;
    database: string | null;
    note?: string | null;
    override?: CredentialOverride;
    root?: string;
    onFinished?: (job: JobView) => void;
  },
): { jobId: string } | { error: JobError } {
  const { target, database } = input;
  if (database !== null && !isValidDatabaseName(database)) return { error: "invalidDatabase" };
  const gate = admit(target.id);
  if (gate) return { error: gate };

  const root = input.root ?? stashDir();
  void failStaleDumps(db, root, new Set([...live().values()].map(({ job }) => job.dumpId)));
  const credentials = readCredentials(target.engine, target.info.env, input.override);
  const record = createDump(db, root, {
    projectId: target.projectId,
    projectName: target.projectName,
    containerName: target.name,
    engine: target.engine,
    database,
    note: input.note?.trim().slice(0, 500) || null,
  });
  const entry: Live = { job: newJob("dump", record, target, null, true), containerId: target.id, cancel: () => undefined };
  live().set(entry.job.id, entry);
  void runDump(
    db,
    entry,
    record,
    root,
    target,
    dumpCommand(target.engine, credentials, database),
    estimateCommand(target.engine, credentials, database),
  ).then(() => input.onFinished?.(entry.job));
  return { jobId: entry.job.id };
}

export function startRestore(
  input: { dump: DumpRecord; target: JobTarget; database: string | null; override?: CredentialOverride; root?: string },
): { jobId: string } | { error: JobError } {
  const { dump, target, database } = input;
  if (dump.status !== "done") return { error: "notFinished" };
  if (database !== null && !isValidDatabaseName(database)) return { error: "invalidDatabase" };
  const root = input.root ?? stashDir();
  if (!dumpPath(root, dump.fileName)) return { error: "fileMissing" };
  const gate = admit(target.id);
  if (gate) return { error: gate };

  const credentials = readCredentials(target.engine, target.info.env, input.override);
  const entry: Live = { job: newJob("restore", { ...dump, database }, target, null, false), containerId: target.id, cancel: () => undefined };
  live().set(entry.job.id, entry);
  void runRestore(
    entry,
    dump,
    root,
    target,
    restoreCommand(target.engine, credentials, { source: dump.database, target: database }),
    database === null ? null : ensureDatabaseCommand(target.engine, credentials, database),
  );
  return { jobId: entry.job.id };
}

/**
 * Loading replaces what is there, with no way back: this keeps a copy first, and loads nothing
 * unless the copy was made. The job shown is the dump, then the load in its own right.
 */
export function startRestoreAfterDump(
  db: Db,
  input: { dump: DumpRecord; target: JobTarget; database: string | null; note: string; override?: CredentialOverride; root?: string },
): { jobId: string } | { error: JobError } {
  const { dump, target, database, note, override, root } = input;
  if (dump.status !== "done") return { error: "notFinished" };
  if (!dumpPath(root ?? stashDir(), dump.fileName)) return { error: "fileMissing" };
  return startDump(db, {
    target,
    database,
    note,
    override,
    root,
    onFinished: (safety) => {
      if (safety.status !== "done") {
        safety.detail = "Nothing was loaded: this copy of the database could not be made.";
        return;
      }
      const started = startRestore({ dump, target, database, override, root });
      if ("error" in started) safety.detail = `The dump was not loaded: ${started.error}.`;
    },
  });
}
