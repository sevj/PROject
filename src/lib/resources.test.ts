import { describe, expect, it } from "vitest";
import { parseBytes, parseDiskSummary, parseDiskUsage, parseStats, planCleanup, volumeOwner } from "./resources";

describe("parseBytes", () => {
  it("counts in 1000 for df units and 1024 for stats units", () => {
    expect(parseBytes("132.8kB")).toBe(132_800);
    expect(parseBytes("1.5GB")).toBe(1_500_000_000);
    expect(parseBytes("773.8MiB")).toBe(Math.round(773.8 * 1024 * 1024));
    expect(parseBytes("0B")).toBe(0);
    expect(parseBytes("N/A")).toBe(0);
    expect(parseBytes(undefined)).toBe(0);
  });
});

describe("parseStats", () => {
  it("reads one object per line and skips the broken ones", () => {
    const line = JSON.stringify({ ID: "abc", Name: "db", CPUPerc: "1.61%", MemUsage: "30MiB / 7.5GiB", MemPerc: "0.39%", PIDs: "6" });
    const stats = parseStats(`${line}\nnot json\n`);
    expect(stats).toEqual([
      { id: "abc", name: "db", cpuPercent: 1.61, memBytes: 30 * 1024 ** 2, memLimit: Math.round(7.5 * 1024 ** 3), memPercent: 0.39, pids: 6 },
    ]);
  });
});

const df = JSON.stringify({
  Images: [
    { ID: "sha256:a", Repository: "postgres", Tag: "17", Size: "300MB", Containers: "1" },
    { ID: "sha256:b", Repository: "<none>", Tag: "<none>", Size: "178MB", Containers: "0" },
    { ID: "sha256:c", Repository: "<none>", Tag: "<none>", Size: "10MB", Containers: "1" },
  ],
  Containers: [
    { ID: "1", Names: "up", Image: "postgres:17", Size: "1MB", State: "running" },
    { ID: "2", Names: "down", Image: "postgres:17", Size: "2MB", State: "exited" },
  ],
  Volumes: [
    { Name: "shop_db", Size: "2GB", Links: "1", Labels: "com.docker.compose.project=shop,com.docker.compose.volume=db" },
    { Name: "abc", Size: "1kB", Links: "0", Labels: "com.docker.volume.anonymous=" },
  ],
  BuildCache: [
    { Size: "5MB", InUse: "false" },
    { Size: "7MB", InUse: "true" },
  ],
});

describe("parseDiskUsage and planCleanup", () => {
  const usage = parseDiskUsage(df);

  it("reads volumes with their project and whether they are anonymous", () => {
    expect(usage.volumes).toEqual([
      { name: "shop_db", bytes: 2e9, links: 1, composeProject: "shop", anonymous: false },
      { name: "abc", bytes: 1000, links: 0, composeProject: null, anonymous: true },
    ]);
  });

  it("only proposes to remove what nothing uses", () => {
    const plan = planCleanup(usage);
    expect(plan.danglingImages.map(({ id }) => id)).toEqual(["b"]);
    expect(plan.stoppedContainers.map(({ name }) => name)).toEqual(["down"]);
    expect(plan.cache).toEqual({ count: 2, bytes: 12e6, reclaimableBytes: 5e6 });
  });

  it("survives an unreadable answer", () => {
    expect(parseDiskUsage("oops").images).toEqual([]);
  });
});

describe("volumeOwner", () => {
  const projects = [{ id: 3, name: "Shop", path: "/home/me/Projects/Shop" }];
  it("matches the compose name to the folder", () => {
    expect(volumeOwner({ composeProject: "shop" }, projects)).toEqual({ id: 3, name: "Shop" });
    expect(volumeOwner({ composeProject: "other" }, projects)).toBeNull();
    expect(volumeOwner({ composeProject: null }, projects)).toBeNull();
  });
});

describe("parseDiskSummary", () => {
  it("reads sizes and the reclaimable part without its percentage", () => {
    const out = [
      '{"Active":"47","Reclaimable":"32.33GB (42%)","Size":"76.12GB","TotalCount":"112","Type":"Images"}',
      '{"Active":"0","Reclaimable":"5.867GB","Size":"48.23GB","TotalCount":"1324","Type":"Build Cache"}',
    ].join("\n");
    const summary = parseDiskSummary(out);
    expect(summary.images).toEqual({ count: 112, bytes: 76.12e9, reclaimableBytes: 32.33e9 });
    expect(summary.cache.reclaimableBytes).toBe(5.867e9);
    expect(summary.volumes.count).toBe(0);
  });
});
