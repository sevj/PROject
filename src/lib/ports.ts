/** Which ports the machine uses, from Docker, from compose files and from the system. Pure. */

export type Protocol = "tcp" | "udp";

export type PortEntry = {
  port: number;
  protocol: Protocol;
  /** Docker publishes it now, a compose file declares it, or a process of the machine listens on it. */
  kind: "docker" | "declared" | "host";
  /** Two entries of the same owner are the same thing seen twice. */
  owner: string;
  /** The container, service or process, as the user would call it. */
  label: string;
  projectId: number | null;
  projectName: string | null;
  /** The address it is bound to when it is not every address. */
  address: string | null;
};

const MAX_RANGE = 64;

/** "8000" or "8000-8003"; a range too large to be real is ignored. */
function expand(text: string): number[] {
  const match = /^(\d+)(?:-(\d+))?$/.exec(text.trim());
  if (!match) return [];
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  if (end < start || end - start >= MAX_RANGE || end > 65535 || start < 1) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export type PublishedPort = { port: number; protocol: Protocol; address: string | null };

/** The `Ports` column of `docker ps`: "0.0.0.0:5450->5432/tcp, [::]:5450->5432/tcp, 80/tcp". */
export function parsePsPorts(text: string): PublishedPort[] {
  const found = new Map<string, PublishedPort>();
  for (const part of text.split(",")) {
    const match = /^\s*(?:(\[[^\]]*\]|[\d.]+):)?([\d-]+)->[\d-]+\/(tcp|udp)\s*$/.exec(part);
    if (!match) continue;
    const address = match[1] && match[1] !== "0.0.0.0" && match[1] !== "[::]" ? match[1] : null;
    for (const port of expand(match[2])) {
      // IPv4 and IPv6 bind the same port: one line for the reader.
      const key = `${port}/${match[3]}/${address ?? ""}`;
      if (!found.has(key)) found.set(key, { port, protocol: match[3] as Protocol, address });
    }
  }
  return [...found.values()];
}

/** What `docker-stack` reads from compose: "5438:5432", "8080:80/udp", "9000" (not published). */
export function parseDeclaredPort(text: string): { port: number; protocol: Protocol; address: string | null }[] {
  const [mapping, protocol = "tcp"] = text.trim().split("/");
  if (protocol !== "tcp" && protocol !== "udp") return [];
  const parts = mapping.split(":");
  // A single number is a container port that Docker publishes on a random one.
  if (parts.length < 2) return [];
  const published = parts.length === 2 ? parts[0] : parts[parts.length - 2];
  const address = parts.length > 2 ? parts.slice(0, -2).join(":") : null;
  return expand(published).map((port) => ({ port, protocol, address }));
}

export type Listener = { port: number; address: string | null; process: string | null };

/** `ss -tlnpH`: one listening socket per line. */
export function parseListeners(output: string): Listener[] {
  const found = new Map<string, Listener>();
  for (const line of output.split("\n")) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || columns[0] !== "LISTEN") continue;
    const local = columns[3];
    const at = local.lastIndexOf(":");
    const port = Number(local.slice(at + 1));
    if (at < 0 || !Number.isInteger(port) || port < 1) continue;
    const host = local.slice(0, at).replace(/%.*$/, "");
    const address = host === "*" || host === "0.0.0.0" || host === "[::]" ? null : host;
    const process = /users:\(\("([^"]*)"/.exec(line)?.[1] ?? null;
    const key = `${port}/${address ?? ""}`;
    if (!found.has(key)) found.set(key, { port, address, process });
  }
  return [...found.values()];
}

export type PortStatus = "taken" | "overlap" | "ok";

export type PortRow = {
  port: number;
  protocol: Protocol;
  entries: PortEntry[];
  /**
   * `taken`: something is using it now and something else wants it.
   * `overlap`: nothing uses it now but two things declare it, so they cannot run together.
   */
  status: PortStatus;
};

/** Merges the three sources by port and decides which ports collide. Collisions come first. */
export function buildPortRows(entries: PortEntry[]): PortRow[] {
  const published = new Set(entries.filter((entry) => entry.kind === "docker").map((entry) => entry.port));
  const live = new Set(entries.filter((entry) => entry.kind !== "declared").map((entry) => `${entry.port}/${entry.protocol}/${entry.owner}`));

  const kept = entries.filter((entry) => {
    // A listener on a published port is Docker's own proxy, not another program.
    if (entry.kind === "host" && published.has(entry.port)) return false;
    // A declared port that Docker already publishes for the same service is the same thing.
    if (entry.kind === "declared" && live.has(`${entry.port}/${entry.protocol}/${entry.owner}`)) return false;
    return true;
  });

  const rows = new Map<string, PortRow>();
  for (const entry of kept) {
    const key = `${entry.port}/${entry.protocol}`;
    const row = rows.get(key) ?? { port: entry.port, protocol: entry.protocol, entries: [], status: "ok" as PortStatus };
    row.entries.push(entry);
    rows.set(key, row);
  }
  const order = { docker: 0, host: 1, declared: 2 } as const;
  for (const row of rows.values()) {
    row.entries.sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label, "fr"));
    const owners = new Set(row.entries.map((entry) => entry.owner));
    if (owners.size > 1) row.status = row.entries.some((entry) => entry.kind !== "declared") ? "taken" : "overlap";
  }
  const rank = { taken: 0, overlap: 1, ok: 2 } as const;
  return [...rows.values()].sort((a, b) => rank[a.status] - rank[b.status] || a.port - b.port || a.protocol.localeCompare(b.protocol));
}
