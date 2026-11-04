import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type CleanupPlan,
  type ContainerStat,
  type DiskSummary,
  type DiskUsage,
  parseDiskSummary,
  parseDiskUsage,
  parseStats,
  planCleanup,
  volumeOwner,
} from "@/lib/resources";
import type { Db } from "./db/client";
import { projects } from "./db/schema";

const run = promisify(execFile);
const dockerError = (error: unknown) => (error as { stderr?: string }).stderr?.trim() || String(error);

export type StatsResult = { stats: ContainerStat[]; error: string | null };

/** One sample of every running container. Docker takes about two seconds to measure it. */
export async function readStats(): Promise<StatsResult> {
  try {
    const { stdout } = await run("docker", ["stats", "--no-stream", "--format", "json"], {
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stats: parseStats(stdout), error: null };
  } catch (error) {
    return { stats: [], error: dockerError(error) };
  }
}

export type VolumeRow = DiskUsage["volumes"][number] & { owner: { id: number; name: string } | null };

export type DiskReport = {
  summary: DiskSummary;
  plan: CleanupPlan;
  images: DiskUsage["images"];
  volumes: VolumeRow[];
  error: string | null;
};

const EMPTY: Omit<DiskReport, "error"> = {
  summary: parseDiskSummary(""),
  plan: { danglingImages: [], stoppedContainers: [], cache: { count: 0, bytes: 0, reclaimableBytes: 0 } },
  images: [],
  volumes: [],
};

/** Read when asked and never stored: Docker is the only place that knows. */
export async function readDisk(db: Db): Promise<DiskReport> {
  try {
    const [summary, detail] = await Promise.all([
      run("docker", ["system", "df", "--format", "json"], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }),
      run("docker", ["system", "df", "-v", "--format", "json"], { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }),
    ]);
    const usage = parseDiskUsage(detail.stdout);
    const known = db.select({ id: projects.id, name: projects.name, path: projects.path }).from(projects).all();
    return {
      summary: parseDiskSummary(summary.stdout),
      plan: planCleanup(usage),
      images: usage.images,
      volumes: usage.volumes
        .map((volume) => ({ ...volume, owner: volumeOwner(volume, known) }))
        .sort((a, b) => b.bytes - a.bytes),
      error: null,
    };
  } catch (error) {
    return { ...EMPTY, error: dockerError(error) };
  }
}

export type CleanupKind = "images" | "containers" | "cache";

const CLEANUP: Record<CleanupKind, string[]> = {
  // Dangling images only: never `-a`, which would also take the images of stopped projects.
  images: ["image", "prune", "--force"],
  containers: ["container", "prune", "--force"],
  // What no build uses at the moment.
  cache: ["builder", "prune", "--force"],
};

/** Docker's own prune commands: they refuse what is in use. */
export async function cleanup(kind: CleanupKind): Promise<{ output: string } | { error: string }> {
  try {
    const { stdout } = await run("docker", CLEANUP[kind], { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
    return { output: stdout };
  } catch (error) {
    return { error: dockerError(error) };
  }
}

/** Docker refuses a volume that a container still mounts. */
export async function removeVolume(name: string): Promise<{ ok: true } | { error: string }> {
  try {
    await run("docker", ["volume", "rm", name], { timeout: 60_000 });
    return { ok: true };
  } catch (error) {
    return { error: dockerError(error) };
  }
}

