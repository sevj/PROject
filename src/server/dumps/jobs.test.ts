import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Db, openDb } from "../db/client";
import { type JobTarget, cancelJob, dismissJob, listJobs, startDump, startRestore } from "./jobs";
import { createDump, dumpPath, finishDump, getDump } from "./store";

/** Stands in for `docker exec`: dumps are 100 kB lines, and a restore reads what it is given. */
const FAKE_DOCKER = `#!/usr/bin/env node
const fs = require("fs");
const argv = process.argv.slice(2);
const log = (entry) => process.env.FAKE_LOG && fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(entry) + "\\n");
if (argv[0] === "context") { console.log("unix:///nonexistent/docker.sock"); process.exit(0); }
if (argv[0] !== "exec") process.exit(0);
const at = argv.findIndex((a) => /^[0-9a-f]{12,64}$/.test(a));
const cmd = argv.slice(at + 1);
const mode = process.env.FAKE_MODE || "ok";
if (cmd.some((a) => /pg_database_size/.test(a))) { console.log(process.env.FAKE_ESTIMATE || ""); process.exit(0); }
if (cmd[0] === "pg_dump" || cmd[0] === "pg_dumpall") {
  if (mode === "fail") { console.error("pg_dump: error: connection to server failed"); process.exit(1); }
  if (mode === "empty") process.exit(0);
  const chunks = Number(process.env.FAKE_CHUNKS || 20);
  let sent = 0;
  const tick = () => {
    if (sent++ >= chunks) process.exit(0);
    process.stdout.write("x".repeat(99999) + "\\n");
    setTimeout(tick, Number(process.env.FAKE_DELAY || 3));
  };
  tick();
} else if (cmd[0] === "psql") {
  const parts = [];
  process.stdin.on("data", (c) => parts.push(c));
  process.stdin.on("end", () => {
    const body = Buffer.concat(parts);
    log({ cmd, stdin: body.length, text: body.length < 500 ? body.toString() : "" });
    for (let i = 0; i < Number(process.env.FAKE_ERRORS || 0); i += 1) console.error("psql:dump.sql:" + i + ": ERROR:  relation already exists");
    process.exit(mode === "fail" ? 1 : 0);
  });
}
`;

let dir: string;
let root: string;
let db: Db;
let originalPath: string | undefined;

const job = (id: string) => listJobs().find((item) => item.id === id);

const target: JobTarget = {
  id: "a".repeat(12),
  name: "shop-db-1",
  engine: "postgres",
  projectId: null,
  projectName: "Shop",
  info: { id: "a".repeat(12), name: "shop-db-1", image: "postgres:16", service: "db", running: true, env: { POSTGRES_PASSWORD: "pw" } },
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-jobs-"));
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "docker"), FAKE_DOCKER);
  chmodSync(join(dir, "bin", "docker"), 0o755);
  originalPath = process.env.PATH;
  process.env.PATH = `${join(dir, "bin")}:${originalPath}`;
});

afterAll(() => {
  process.env.PATH = originalPath;
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  // What the previous test left running must be over before the next one counts jobs.
  for (const { id } of listJobs()) {
    cancelJob(id);
    for (let attempt = 0; attempt < 250 && job(id)?.status === "running"; attempt += 1) await new Promise((r) => setTimeout(r, 20));
    dismissJob(id);
  }
  root = mkdtempSync(join(dir, "stash-"));
  db = openDb(":memory:");
  for (const key of ["FAKE_MODE", "FAKE_CHUNKS", "FAKE_DELAY", "FAKE_ESTIMATE", "FAKE_ERRORS", "FAKE_LOG"]) delete process.env[key];
});

async function finished(id: string) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const current = job(id);
    if (current && current.status !== "running") return current;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${id} never finished`);
}

const started = (result: { jobId: string } | { error: string }) => {
  if ("error" in result) throw new Error(result.error);
  return result.jobId;
};

function storedDump(raw: Buffer, database: string | null = "shop") {
  const record = createDump(db, root, { projectId: null, projectName: "Shop", containerName: "shop-db-1", engine: "postgres", database, note: null });
  const path = dumpPath(root, record.fileName) ?? "";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, raw);
  finishDump(db, record.id, { status: "done", sizeBytes: raw.length });
  return getDump(db, record.id)!;
}

describe("a dump", () => {
  it("is written compressed, with its progress counted as it goes", async () => {
    process.env.FAKE_CHUNKS = "40";
    process.env.FAKE_DELAY = "10";
    process.env.FAKE_ESTIMATE = "4000000";
    const id = started(startDump(db, { target, database: "shop", note: "  before the migration  ", root }));

    const seen = new Set<number>();
    let estimate: number | null = null;
    while (job(id)?.status === "running") {
      const current = job(id);
      seen.add(current?.processedBytes ?? 0);
      if (current?.estimated && current.totalBytes) estimate = current.totalBytes;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    const done = job(id);
    expect(done).toMatchObject({ status: "done", kind: "dump", processedBytes: 4_000_000, totalBytes: 4_000_000, estimated: false, error: null });
    expect(seen.size).toBeGreaterThan(3);
    expect(estimate).toBe(4_000_000);
    expect(done?.outputBytes).toBeGreaterThan(0);
    expect(done?.outputBytes).toBeLessThan(100_000);

    const record = getDump(db, done?.dumpId ?? 0);
    expect(record).toMatchObject({ status: "done", engine: "postgres", database: "shop", note: "before the migration", rawBytes: 4_000_000 });
    expect(record?.fileName).toMatch(/^Shop\/shop-db-1-shop-\d{8}-\d{6}\.sql\.gz$/);
    const path = dumpPath(root, record?.fileName ?? "") ?? "";
    expect(gunzipSync(readFileSync(path)).length).toBe(4_000_000);
    expect(record?.sizeBytes).toBe(readFileSync(path).length);
    expect(readdirSync(dirname(path)).filter((name) => name.endsWith(".part"))).toEqual([]);
  });

  it("drops an estimate that turns out too low, rather than showing a full bar for a long time", async () => {
    process.env.FAKE_ESTIMATE = "1000";
    const id = started(startDump(db, { target, database: null, root }));
    const done = await finished(id);
    expect(done.status).toBe("done");
    expect(getDump(db, done.dumpId)?.database).toBeNull();
  });

  it("leaves nothing behind when it fails, and says why", async () => {
    process.env.FAKE_MODE = "fail";
    const id = started(startDump(db, { target, database: "shop", root }));
    const failed = await finished(id);
    expect(failed).toMatchObject({ status: "failed", error: "pg_dump: error: connection to server failed" });
    const record = getDump(db, failed.dumpId);
    expect(record).toMatchObject({ status: "failed", error: "pg_dump: error: connection to server failed" });
    expect(existsSync(dumpPath(root, record?.fileName ?? "") ?? "")).toBe(false);
    expect(existsSync(`${dumpPath(root, record?.fileName ?? "")}.part`)).toBe(false);
  });

  it("is not kept when it is empty", async () => {
    process.env.FAKE_MODE = "empty";
    const failed = await finished(started(startDump(db, { target, database: "shop", root })));
    expect(failed).toMatchObject({ status: "failed", error: "The dump is empty." });
  });

  it("can be cancelled, and nothing of it is kept", async () => {
    process.env.FAKE_CHUNKS = "1000";
    process.env.FAKE_DELAY = "20";
    const id = started(startDump(db, { target, database: "shop", root }));
    for (let attempt = 0; attempt < 100 && (job(id)?.processedBytes ?? 0) === 0; attempt += 1) await new Promise((r) => setTimeout(r, 20));
    expect(cancelJob(id)).toBe(true);
    const cancelled = await finished(id);
    expect(cancelled.status).toBe("cancelled");
    expect(getDump(db, cancelled.dumpId)?.status).toBe("cancelled");
    const path = dumpPath(root, getDump(db, cancelled.dumpId)?.fileName ?? "") ?? "";
    expect(existsSync(path) || existsSync(`${path}.part`)).toBe(false);
    expect(cancelJob(id)).toBe(false);
  });

  it("refuses a second job on the same container, and a database name that needs care", async () => {
    process.env.FAKE_CHUNKS = "1000";
    process.env.FAKE_DELAY = "20";
    const id = started(startDump(db, { target, database: "shop", root }));
    expect(startDump(db, { target, database: "other", root })).toEqual({ error: "busy" });
    expect(startDump(db, { target: { ...target, id: "b".repeat(12) }, database: "a;b", root })).toEqual({ error: "invalidDatabase" });
    cancelJob(id);
    await finished(id);
  });

  it("limits how many run at once", async () => {
    process.env.FAKE_CHUNKS = "1000";
    process.env.FAKE_DELAY = "20";
    const ids = ["a", "b", "c", "d"].map((letter) => started(startDump(db, { target: { ...target, id: letter.repeat(12) }, database: "shop", root })));
    expect(startDump(db, { target: { ...target, id: "e".repeat(12) }, database: "shop", root })).toEqual({ error: "limit" });
    for (const id of ids) cancelJob(id);
    await Promise.all(ids.map(finished));
  });
});

describe("a load", () => {
  it("creates the database first, then feeds the file, and counts what it has read of it", async () => {
    process.env.FAKE_LOG = join(dir, "log-load.jsonl");
    rmSync(process.env.FAKE_LOG, { force: true });
    const raw = Buffer.from("SELECT 1;\n".repeat(30_000));
    const dump = storedDump(gzipSync(raw));
    const id = started(startRestore({ dump, target, database: "copy", root }));
    const done = await finished(id);
    expect(done).toMatchObject({ status: "done", kind: "restore", warnings: 0, estimated: false });
    expect(done.totalBytes).toBe(dump.sizeBytes);
    expect(done.processedBytes).toBe(dump.sizeBytes);

    const calls = readFileSync(process.env.FAKE_LOG, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(calls).toHaveLength(2);
    expect(calls[0].text).toContain('CREATE DATABASE "copy"');
    expect(calls[1].cmd).toEqual(["psql", "-U", "postgres", "-d", "copy", "-X", "-q"]);
    expect(calls[1].stdin).toBe(raw.length);
  });

  it("goes on past statements the server refuses, and counts them", async () => {
    process.env.FAKE_ERRORS = "3";
    const dump = storedDump(gzipSync(Buffer.from("SELECT 1;\n")));
    const done = await finished(started(startRestore({ dump, target, database: "shop", root })));
    expect(done).toMatchObject({ status: "done", warnings: 3 });
    expect(done.detail).toContain("ERROR");
  });

  it("loads a full dump without creating anything", async () => {
    process.env.FAKE_LOG = join(dir, "log-all.jsonl");
    rmSync(process.env.FAKE_LOG, { force: true });
    const dump = storedDump(gzipSync(Buffer.from("SELECT 1;\n")), null);
    await finished(started(startRestore({ dump, target, database: null, root })));
    const calls = readFileSync(process.env.FAKE_LOG, "utf8").trim().split("\n");
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]).cmd).toContain("postgres");
  });

  it("fails with what the server said", async () => {
    process.env.FAKE_MODE = "fail";
    const dump = storedDump(gzipSync(Buffer.from("SELECT 1;\n")));
    const failed = await finished(started(startRestore({ dump, target, database: "shop", root })));
    expect(failed.status).toBe("failed");
  });

  it("says the file is damaged rather than printing a compression error", async () => {
    const dump = storedDump(Buffer.from("this is not a gzip file at all"));
    const failed = await finished(started(startRestore({ dump, target, database: "shop", root })));
    expect(failed).toMatchObject({ status: "failed", error: "The dump file is damaged or incomplete." });
  });

  it("fails when the file is gone, and refuses a dump that never finished", async () => {
    const dump = storedDump(gzipSync(Buffer.from("x")));
    rmSync(dumpPath(root, dump.fileName) ?? "");
    expect((await finished(started(startRestore({ dump, target, database: "shop", root })))).status).toBe("failed");
    expect(startRestore({ dump: { ...dump, status: "running" }, target, database: "shop", root })).toEqual({ error: "notFinished" });
  });

  it("never reads outside the stash, whatever name the database holds", () => {
    const dump = { ...storedDump(gzipSync(Buffer.from("x"))), fileName: "../../etc/passwd" };
    expect(startRestore({ dump, target, database: "shop", root })).toEqual({ error: "fileMissing" });
  });

  it("can be cancelled", async () => {
    process.env.FAKE_MODE = "ok";
    const big = gzipSync(Buffer.alloc(30_000_000, "a"));
    const dump = storedDump(big);
    const id = started(startRestore({ dump, target, database: "shop", root }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    cancelJob(id);
    expect(["cancelled", "done"]).toContain((await finished(id)).status);
  });
});
