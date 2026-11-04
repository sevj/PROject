import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Engine } from "@/lib/db-engines";
import { openDb } from "../db/client";
import { inspectInfo, runQuick } from "./docker-run";
import { estimateCommand, listDatabasesCommand, parseDatabases, parseEstimate, readCredentials, restoreCommand } from "./engines";
import { type JobTarget, listJobs, startDump, startRestore } from "./jobs";
import { dumpPath, getDump } from "./store";

/** Against real servers, so it only runs when asked: PM_DOCKER_TESTS=1 pnpm test engines.docker */
const enabled = process.env.PM_DOCKER_TESTS === "1";

type Spec = { engine: Engine; image: string; env: string[]; rows: number };
const SPECS: Spec[] = [
  { engine: "postgres", image: "postgres:17-alpine", env: ["POSTGRES_PASSWORD=pw", "POSTGRES_DB=shop"], rows: 50_000 },
  { engine: "mysql", image: "mysql:9.7.0", env: ["MYSQL_ROOT_PASSWORD=pw", "MYSQL_DATABASE=shop"], rows: 900 },
  { engine: "mariadb", image: "mariadb:10.11.2", env: ["MARIADB_ROOT_PASSWORD=pw", "MARIADB_DATABASE=shop"], rows: 900 },
];

const names = SPECS.map(({ engine }) => `pm-e2e-${engine}`);
const docker = (...args: string[]) => execFileSync("docker", args, { stdio: ["ignore", "pipe", "pipe"] }).toString();

afterAll(() => {
  for (const name of names) {
    try {
      docker("rm", "-f", name);
    } catch {
      // Already gone.
    }
  }
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function finished(id: string) {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const job = listJobs().find((item) => item.id === id);
    if (job && job.status !== "running") return job;
    await sleep(200);
  }
  throw new Error("job never finished");
}

describe.skipIf(!enabled)("real database servers", () => {
  for (const spec of SPECS) {
    it(`dumps and loads ${spec.engine} (${spec.image})`, { timeout: 240_000 }, async () => {
      const name = `pm-e2e-${spec.engine}`;
      docker("rm", "-f", name);
      docker("run", "-d", "--name", name, ...spec.env.flatMap((value) => ["-e", value]), spec.image);
      const [info] = await inspectInfo([name]);
      const credentials = readCredentials(spec.engine, info.env);
      const target: JobTarget = { id: info.id, name, engine: spec.engine, projectId: null, projectName: "E2E", info };

      // Servers restart once while they initialize: wait until one answers twice in a row.
      let answers = 0;
      for (let attempt = 0; attempt < 120 && answers < 2; attempt += 1) {
        const reply = await runQuick(info.id, listDatabasesCommand(spec.engine, credentials)).catch(() => null);
        answers = reply?.code === 0 && parseDatabases(spec.engine, reply.stdout).includes("shop") ? answers + 1 : 0;
        await sleep(1500);
      }
      expect(answers).toBe(2);

      const sql = (text: string, database: string) => runQuick(info.id, { ...restoreCommand(spec.engine, credentials, { source: null, target: database }), stdin: text });
      const seed =
        spec.engine === "postgres"
          ? `CREATE TABLE t (id int, v text); INSERT INTO t SELECT g, md5(g::text) FROM generate_series(1, ${spec.rows}) g;`
          : `CREATE TABLE t (id INT, v VARCHAR(40)); INSERT INTO t WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < ${spec.rows}) SELECT n, CONCAT('row-', n) FROM s;`;
      expect((await sql(seed, "shop")).code, "seeding").toBe(0);

      const estimate = await runQuick(info.id, estimateCommand(spec.engine, credentials, "shop"));
      expect(parseEstimate(estimate.stdout), estimate.stderr).toBeGreaterThan(0);

      const root = mkdtempSync(join(tmpdir(), "pm-real-"));
      const db = openDb(":memory:");
      try {
        const dumpJob = await finished((startDump(db, { target, database: "shop", note: "real", root }) as { jobId: string }).jobId);
        expect(dumpJob, dumpJob.error ?? "").toMatchObject({ status: "done" });
        expect(dumpJob.processedBytes).toBeGreaterThan(1000);
        expect(getDump(db, dumpJob.dumpId)?.sizeBytes).toBeGreaterThan(0);

        const dump = getDump(db, dumpJob.dumpId)!;
        expect(dumpPath(root, dump.fileName)).not.toBeNull();
        const loadJob = await finished((startRestore({ dump, target, database: "copy", root }) as { jobId: string }).jobId);
        expect(loadJob, loadJob.error ?? "").toMatchObject({ status: "done", warnings: 0 });
        expect(loadJob.processedBytes).toBe(dump.sizeBytes);

        const count = await sql("SELECT COUNT(*) FROM t;", "copy");
        expect(count.stdout.replace(/\s+/g, " "), count.stderr).toContain(String(spec.rows));

        // Loading it again over what is there replaces it, without a single refused statement.
        const again = await finished((startRestore({ dump, target, database: "copy", root }) as { jobId: string }).jobId);
        expect(again, again.error ?? "").toMatchObject({ status: "done", warnings: 0 });

        const all = await finished((startDump(db, { target, database: null, root }) as { jobId: string }).jobId);
        expect(all, all.error ?? "").toMatchObject({ status: "done" });
      } finally {
        rmSync(root, { recursive: true, force: true });
        docker("rm", "-f", name);
      }
    });
  }
});
