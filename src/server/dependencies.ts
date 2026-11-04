import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  type DependencyAnalysis,
  type DependencySummary,
  type Ecosystem,
  type EcosystemResult,
  parseComposerAudit,
  parseComposerOutdated,
  parseNodeOutdated,
  parseNpmAudit,
  parsePnpmAudit,
  parseYarnAudit,
  parseYarnOutdated,
  summarize,
} from "@/lib/dependencies";
import type { Db } from "./db/client";
import { analyses } from "./db/schema";
import { listProjectContainers } from "./docker-containers";

const KIND = "dependencies";
const COMMAND_TIMEOUT_MS = 180_000;
const IGNORED_DIRS = new Set(["node_modules", "vendor", "target", "dist", "build", "var"]);

export type Target = { ecosystem: Ecosystem; folder: string };

type Run = { stdout: string; stderr: string; code: number | string | null };

/** Never rejects: outdated packages and advisories make these tools exit with 1. */
function run(file: string, args: string[], cwd: string): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1", CI: "1" } },
      (error, stdout, stderr) => {
        const code = error ? ((error as NodeJS.ErrnoException).code ?? 1) : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr), code: typeof code === "string" ? code : Number(code) });
      },
    );
  });
}

const lastLine = (text: string) => text.trim().split("\n").filter(Boolean).at(-1)?.slice(0, 300) ?? "";

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The managers a folder uses, from its manifests and lock files. Nothing is run here. */
export async function detectTargets(projectPath: string): Promise<Target[]> {
  const folders = [{ folder: ".", dir: projectPath }];
  try {
    for (const entry of await readdir(projectPath, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && !IGNORED_DIRS.has(entry.name)) {
        folders.push({ folder: entry.name, dir: join(projectPath, entry.name) });
      }
    }
  } catch {
    return [];
  }
  const targets: Target[] = [];
  for (const { folder, dir } of folders) {
    if (existsSync(join(dir, "package.json"))) {
      const declared = String((await readJson(join(dir, "package.json")))?.packageManager ?? "");
      const manager: Ecosystem = declared.startsWith("pnpm")
        ? "pnpm"
        : declared.startsWith("yarn")
          ? "yarn"
          : existsSync(join(dir, "pnpm-lock.yaml"))
            ? "pnpm"
            : existsSync(join(dir, "yarn.lock"))
              ? "yarn"
              : "npm";
      targets.push({ ecosystem: manager, folder });
    }
    if (existsSync(join(dir, "composer.json"))) targets.push({ ecosystem: "composer", folder });
  }
  return targets;
}

async function devPackages(dir: string, ecosystem: Ecosystem): Promise<Set<string>> {
  const manifest = await readJson(join(dir, ecosystem === "composer" ? "composer.json" : "package.json"));
  const dev = manifest?.[ecosystem === "composer" ? "require-dev" : "devDependencies"];
  return new Set(dev && typeof dev === "object" ? Object.keys(dev) : []);
}

/** pnpm is often only reachable through corepack: the first way that exists is kept. */
let pnpmCommand: string[] | null = null;
async function pnpm(): Promise<string[]> {
  if (pnpmCommand) return pnpmCommand;
  for (const candidate of [["pnpm"], ["corepack", "pnpm"], ["npx", "--yes", "corepack@latest", "pnpm"]]) {
    const probe = await run(candidate[0], [...candidate.slice(1), "--version"], process.cwd());
    if (probe.code === 0) return (pnpmCommand = candidate);
  }
  return ["pnpm"];
}

/** A tool that answers with an error object instead of a result, such as `npm audit` without a lock file. */
function reportedError(stdout: string): string | null {
  try {
    const error = (JSON.parse(stdout) as { error?: { summary?: string; detail?: string; message?: string } | string }).error;
    if (!error) return null;
    return typeof error === "string" ? error : (error.summary ?? error.message ?? error.detail ?? "error");
  } catch {
    return null;
  }
}

/** The list, or why there is none. Empty output with a success code is an empty list. */
function readOutput<T>(result: Run, parse: (stdout: string) => T[], empty: T[]): { items: T[]; error: string | null } {
  const reason = reportedError(result.stdout);
  if (reason) return { items: empty, error: reason };
  if (result.stdout.trim() === "") {
    return result.code === 0 ? { items: empty, error: null } : { items: empty, error: lastLine(result.stderr) || String(result.code) };
  }
  return { items: parse(result.stdout), error: null };
}

async function analyzeNode(dir: string, target: Target): Promise<EcosystemResult> {
  const dev = await devPackages(dir, target.ecosystem);
  const [command, ...prefix] = target.ecosystem === "pnpm" ? await pnpm() : [target.ecosystem];
  const [outdated, audit] = await Promise.all(
    (target.ecosystem === "pnpm" ? [["outdated", "--format", "json"], ["audit", "--json"]] : [["outdated", "--json"], ["audit", "--json"]]).map(
      (args) => run(command, [...prefix, ...args], dir),
    ),
  );
  const parseOutdated = (stdout: string) =>
    target.ecosystem === "yarn" ? parseYarnOutdated(stdout, dev) : parseNodeOutdated(stdout, dev);
  const parseAudit = target.ecosystem === "pnpm" ? parsePnpmAudit : target.ecosystem === "yarn" ? parseYarnAudit : parseNpmAudit;
  const list = readOutput(outdated, parseOutdated, []);
  const found = readOutput(audit, parseAudit, []);
  return {
    ecosystem: target.ecosystem,
    folder: target.folder,
    runner: "host",
    outdated: list.items,
    advisories: found.items,
    outdatedError: list.error,
    auditError: found.error,
  };
}

/** Where composer can run: on the machine, or else in a running container of the project that has it. */
async function composerRunner(
  db: Db,
  projectId: number,
  dir: string,
): Promise<{ name: string; exec: (args: string[]) => Promise<Run> } | null> {
  if ((await run("composer", ["--version"], dir)).code === 0) {
    return { name: "host", exec: (args) => run("composer", args, dir) };
  }
  const { containers } = await listProjectContainers(db, projectId);
  for (const container of containers.filter((item) => item.running)) {
    const mount = container.mounts
      .filter((item) => item.type === "bind" && (dir === item.source || dir.startsWith(`${item.source}/`)))
      .sort((a, b) => b.source.length - a.source.length)[0];
    if (!mount) continue;
    const inside = `${mount.destination}${dir.slice(mount.source.length)}`;
    if ((await run("docker", ["exec", container.id, "sh", "-c", "command -v composer"], dir)).code !== 0) continue;
    return { name: container.name, exec: (args) => run("docker", ["exec", "-w", inside, container.id, "composer", ...args], dir) };
  }
  return null;
}

async function analyzeComposer(db: Db, projectId: number, dir: string, target: Target): Promise<EcosystemResult> {
  const base = { ecosystem: target.ecosystem, folder: target.folder, outdated: [], advisories: [] };
  const runner = await composerRunner(db, projectId, dir);
  if (!runner) return { ...base, runner: "-", outdatedError: "composer", auditError: "composer" };
  const dev = await devPackages(dir, "composer");
  // Plugins and scripts are project code: they are not run just to read a version.
  const common = ["--no-interaction", "--no-plugins", "--no-scripts"];
  const [outdated, audit] = await Promise.all([
    runner.exec(["outdated", "--direct", "--format=json", ...common]),
    runner.exec(["audit", "--format=json", ...common]),
  ]);
  const list = readOutput(outdated, (stdout) => parseComposerOutdated(stdout, dev), []);
  const found = readOutput(audit, parseComposerAudit, []);
  return { ...base, runner: runner.name, outdated: list.items, advisories: found.items, outdatedError: list.error, auditError: found.error };
}

const running = new Set<number>();

export type AnalyzeOutcome = { ok: true; analysis: DependencyAnalysis } | { error: "busy" | "noProject" };

/** Runs the managers of the project, then keeps the result with its date. It installs nothing. */
export async function analyzeDependencies(
  db: Db,
  projectId: number,
  projectPath: string,
  now = new Date(),
): Promise<AnalyzeOutcome> {
  if (running.has(projectId)) return { error: "busy" };
  running.add(projectId);
  try {
    const targets = await detectTargets(projectPath);
    const results = await Promise.all(
      targets.map((target) => {
        const dir = target.folder === "." ? projectPath : join(projectPath, target.folder);
        return target.ecosystem === "composer" ? analyzeComposer(db, projectId, dir, target) : analyzeNode(dir, target);
      }),
    );
    const analysis: DependencyAnalysis = { results };
    db.insert(analyses)
      .values({ projectId, kind: KIND, result: analysis, analyzedAt: now })
      .onConflictDoUpdate({ target: [analyses.projectId, analyses.kind], set: { result: analysis, analyzedAt: now } })
      .run();
    return { ok: true, analysis };
  } finally {
    running.delete(projectId);
  }
}

export type StoredDependencies = { analysis: DependencyAnalysis; analyzedAt: number };

export function readDependencies(db: Db, projectId: number): StoredDependencies | null {
  const row = db.select().from(analyses).where(eq(analyses.projectId, projectId)).all().find((item) => item.kind === KIND);
  return row ? { analysis: row.result as DependencyAnalysis, analyzedAt: row.analyzedAt.getTime() } : null;
}

export type DependencyCounters = DependencySummary & { analyzedAt: number };

/** One line per analyzed project, for the counters of the list. */
export function readDependencyCounters(db: Db): Map<number, DependencyCounters> {
  return new Map(
    db
      .select()
      .from(analyses)
      .all()
      .filter((row) => row.kind === KIND)
      .map((row) => [row.projectId, { ...summarize(row.result as DependencyAnalysis), analyzedAt: row.analyzedAt.getTime() }]),
  );
}

export const isAnalyzing = (projectId: number) => running.has(projectId);
