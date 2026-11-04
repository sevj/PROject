/** What Docker says about the machine's resources, turned into numbers. Pure: no Docker call here. */

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

/** "1.2GiB", "45.3MB", "132.8kB", "0B". Docker's `df` counts in 1000, its `stats` in 1024. */
export function parseBytes(text: string | undefined): number {
  const match = /^\s*([\d.]+)\s*([a-z]*)\s*$/i.exec(text ?? "");
  if (!match) return 0;
  const factor = UNITS[match[2].toLowerCase() || "b"];
  const value = Number(match[1]);
  return factor === undefined || Number.isNaN(value) ? 0 : Math.round(value * factor);
}

export type ContainerStat = {
  id: string;
  name: string;
  cpuPercent: number;
  memBytes: number;
  memLimit: number;
  memPercent: number;
  pids: number;
};

type RawStat = { ID?: string; Name?: string; CPUPerc?: string; MemUsage?: string; MemPerc?: string; PIDs?: string };

const percent = (text: string | undefined) => {
  const value = Number.parseFloat(text ?? "");
  return Number.isNaN(value) ? 0 : value;
};

/** `docker stats --no-stream --format json`: one JSON object per line. */
export function parseStats(output: string): ContainerStat[] {
  return output
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const raw = JSON.parse(line) as RawStat;
        const [used, limit] = (raw.MemUsage ?? "").split("/");
        return [
          {
            id: raw.ID ?? "",
            name: raw.Name ?? "",
            cpuPercent: percent(raw.CPUPerc),
            memBytes: parseBytes(used),
            memLimit: parseBytes(limit),
            memPercent: percent(raw.MemPerc),
            pids: Number.parseInt(raw.PIDs ?? "0", 10) || 0,
          },
        ];
      } catch {
        return [];
      }
    });
}

export type DiskImage = { id: string; name: string; bytes: number; containers: number; dangling: boolean };
export type DiskContainer = { id: string; name: string; image: string; bytes: number; running: boolean };
export type DiskVolume = {
  name: string;
  bytes: number;
  /** Containers, running or not, that mount it. */
  links: number;
  composeProject: string | null;
  anonymous: boolean;
};
export type DiskCache = { count: number; bytes: number; reclaimableBytes: number };
export type DiskUsage = {
  images: DiskImage[];
  containers: DiskContainer[];
  volumes: DiskVolume[];
  cache: DiskCache;
};

type RawDf = {
  Images?: { ID?: string; Repository?: string; Tag?: string; Size?: string; Containers?: string }[];
  Containers?: { ID?: string; Names?: string; Image?: string; Size?: string; State?: string }[];
  Volumes?: { Name?: string; Size?: string; Links?: string; Labels?: string }[];
  BuildCache?: { Size?: string; InUse?: string }[];
};

function labelsOf(text: string | undefined): Map<string, string> {
  return new Map(
    (text ?? "")
      .split(",")
      .filter(Boolean)
      .map((pair) => {
        const at = pair.indexOf("=");
        return at < 0 ? ([pair, ""] as const) : ([pair.slice(0, at), pair.slice(at + 1)] as const);
      }),
  );
}

/** `docker system df -v --format json`. */
export function parseDiskUsage(output: string): DiskUsage {
  let raw: RawDf = {};
  try {
    raw = JSON.parse(output) as RawDf;
  } catch {
    // Nothing readable: an empty report is the honest answer.
  }
  const cache = raw.BuildCache ?? [];
  return {
    images: (raw.Images ?? []).map((image) => {
      const none = image.Repository === "<none>";
      return {
        id: (image.ID ?? "").replace(/^sha256:/, ""),
        name: none ? "" : `${image.Repository}${image.Tag && image.Tag !== "<none>" ? `:${image.Tag}` : ""}`,
        bytes: parseBytes(image.Size),
        containers: Number.parseInt(image.Containers ?? "0", 10) || 0,
        dangling: none && (image.Tag === "<none>" || image.Tag === undefined),
      };
    }),
    containers: (raw.Containers ?? []).map((container) => ({
      id: container.ID ?? "",
      name: container.Names ?? "",
      image: container.Image ?? "",
      bytes: parseBytes(container.Size),
      running: container.State === "running",
    })),
    volumes: (raw.Volumes ?? []).map((volume) => {
      const labels = labelsOf(volume.Labels);
      return {
        name: volume.Name ?? "",
        bytes: parseBytes(volume.Size),
        links: Number.parseInt(volume.Links ?? "0", 10) || 0,
        composeProject: labels.get("com.docker.compose.project") ?? null,
        anonymous: labels.has("com.docker.volume.anonymous"),
      };
    }),
    cache: {
      count: cache.length,
      bytes: cache.reduce((sum, entry) => sum + parseBytes(entry.Size), 0),
      reclaimableBytes: cache
        .filter((entry) => entry.InUse !== "true")
        .reduce((sum, entry) => sum + parseBytes(entry.Size), 0),
    },
  };
}

export type DiskSummary = Record<"images" | "containers" | "volumes" | "cache", { count: number; bytes: number; reclaimableBytes: number }>;

/** `docker system df --format json`: the totals Docker itself counts, shared layers included once. */
export function parseDiskSummary(output: string): DiskSummary {
  const summary: DiskSummary = {
    images: { count: 0, bytes: 0, reclaimableBytes: 0 },
    containers: { count: 0, bytes: 0, reclaimableBytes: 0 },
    volumes: { count: 0, bytes: 0, reclaimableBytes: 0 },
    cache: { count: 0, bytes: 0, reclaimableBytes: 0 },
  };
  const keys: Record<string, keyof DiskSummary> = {
    Images: "images",
    Containers: "containers",
    "Local Volumes": "volumes",
    "Build Cache": "cache",
  };
  for (const line of output.split("\n").filter(Boolean)) {
    try {
      const row = JSON.parse(line) as { Type?: string; Size?: string; Reclaimable?: string; TotalCount?: string };
      const key = keys[row.Type ?? ""];
      if (key) {
        summary[key] = {
          count: Number.parseInt(row.TotalCount ?? "0", 10) || 0,
          bytes: parseBytes(row.Size),
          reclaimableBytes: parseBytes((row.Reclaimable ?? "").split(" ")[0]),
        };
      }
    } catch {
      // A line that is not JSON is skipped.
    }
  }
  return summary;
}

/** What a cleanup removes, listed before it is asked. */
export type CleanupPlan = {
  /** Images with no name and no container: what a rebuild leaves behind. */
  danglingImages: DiskImage[];
  stoppedContainers: DiskContainer[];
  cache: DiskCache;
};

export function planCleanup(usage: DiskUsage): CleanupPlan {
  return {
    danglingImages: usage.images.filter((image) => image.dangling && image.containers === 0),
    stoppedContainers: usage.containers.filter((container) => !container.running),
    cache: usage.cache,
  };
}

/** Docker names a project after its folder: lowercase, with only letters, digits, `-` and `_`. */
export const composeProjectName = (folder: string): string => folder.toLowerCase().replace(/[^a-z0-9_-]/g, "");

/** The project a volume belongs to, when its compose name matches the folder of one. */
export function volumeOwner(
  volume: Pick<DiskVolume, "composeProject">,
  projects: { id: number; name: string; path: string }[],
): { id: number; name: string } | null {
  if (!volume.composeProject) return null;
  const found = projects.find(({ path }) => composeProjectName(path.split("/").filter(Boolean).at(-1) ?? "") === volume.composeProject);
  return found ? { id: found.id, name: found.name } : null;
}
