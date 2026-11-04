/** Outdated packages and known vulnerabilities, from the output of the package managers. Pure. */

export type Ecosystem = "npm" | "pnpm" | "yarn" | "composer";
export type Severity = "critical" | "high" | "moderate" | "low" | "info";
export const SEVERITIES: readonly Severity[] = ["critical", "high", "moderate", "low", "info"];

export type OutdatedPackage = {
  name: string;
  current: string | null;
  wanted: string | null;
  latest: string | null;
  dev: boolean;
  /** The latest version is another major one: the update is likely to need work. */
  major: boolean;
};

export type Advisory = {
  package: string;
  severity: Severity;
  title: string;
  /** Only http(s): it is shown as a link. */
  url: string | null;
  range: string | null;
};

/** One manager in one folder of a project. */
export type EcosystemResult = {
  ecosystem: Ecosystem;
  /** "." for the project root, otherwise the subfolder such as "backend". */
  folder: string;
  /** Where it ran, such as "host" or the name of a container. */
  runner: string;
  outdated: OutdatedPackage[];
  advisories: Advisory[];
  /** Why the list of outdated packages is missing, if it is. */
  outdatedError: string | null;
  /** Why the audit is missing, if it is. */
  auditError: string | null;
};

export type DependencyAnalysis = { results: EcosystemResult[] };

export type DependencySummary = {
  outdated: number;
  major: number;
  vulnerabilities: number;
  worst: Severity | null;
  bySeverity: Record<Severity, number>;
};

export function summarize(analysis: DependencyAnalysis): DependencySummary {
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  let outdated = 0;
  let major = 0;
  for (const result of analysis.results) {
    outdated += result.outdated.length;
    major += result.outdated.filter((item) => item.major).length;
    for (const advisory of result.advisories) bySeverity[advisory.severity] += 1;
  }
  const worst = SEVERITIES.find((severity) => bySeverity[severity] > 0) ?? null;
  return {
    outdated,
    major,
    vulnerabilities: SEVERITIES.reduce((sum, severity) => sum + bySeverity[severity], 0),
    worst,
    bySeverity,
  };
}

const majorOf = (version: string | null) => /^v?(\d+)/.exec(version ?? "")?.[1] ?? null;

export function isMajorUpdate(current: string | null, latest: string | null): boolean {
  const from = majorOf(current);
  const to = majorOf(latest);
  return from !== null && to !== null && from !== to;
}

function toSeverity(value: unknown): Severity {
  const text = String(value ?? "").toLowerCase();
  return (SEVERITIES as readonly string[]).includes(text) ? (text as Severity) : text === "medium" ? "moderate" : "info";
}

const safeUrl = (value: unknown): string | null =>
  typeof value === "string" && /^https?:\/\//i.test(value) ? value : null;

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** Some tools print notices before the JSON (Composer plugins do): the object itself is kept. */
function parseJson(output: string): unknown {
  for (const candidate of [output, output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Next candidate.
    }
  }
  return null;
}

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});

function outdatedFrom(
  name: string,
  current: unknown,
  wanted: unknown,
  latest: unknown,
  dev: boolean,
): OutdatedPackage {
  return {
    name,
    current: text(current),
    wanted: text(wanted),
    latest: text(latest),
    dev,
    major: isMajorUpdate(text(current), text(latest)),
  };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en");

/** `npm outdated --json` and `pnpm outdated --format json`: an object by package name. */
export function parseNodeOutdated(output: string, devNames: ReadonlySet<string> = new Set()): OutdatedPackage[] {
  return Object.entries(asObject(parseJson(output)))
    .map(([name, info]) => {
      const entry = asObject(Array.isArray(info) ? info[0] : info);
      const dev = devNames.has(name) || entry.dependencyType === "devDependencies" || entry.type === "devDependencies";
      return outdatedFrom(name, entry.current, entry.wanted, entry.latest, dev);
    })
    .filter((item) => item.latest !== null && item.current !== item.latest)
    .sort(byName);
}

/** `yarn outdated --json` (classic): lines of JSON, one of them a table. */
export function parseYarnOutdated(output: string, devNames: ReadonlySet<string> = new Set()): OutdatedPackage[] {
  const packages: OutdatedPackage[] = [];
  for (const line of output.split("\n")) {
    const row = asObject(parseJson(line));
    if (row.type !== "table") continue;
    const body = asObject(row.data).body;
    if (!Array.isArray(body)) continue;
    for (const cells of body) {
      if (!Array.isArray(cells) || typeof cells[0] !== "string") continue;
      packages.push(outdatedFrom(cells[0], cells[1], cells[2], cells[3], devNames.has(cells[0]) || cells[4] === "devDependencies"));
    }
  }
  return packages.filter((item) => item.latest !== null && item.current !== item.latest).sort(byName);
}

/** `npm audit --json`: an entry by vulnerable package, whose `via` holds the advisories. */
export function parseNpmAudit(output: string): Advisory[] {
  const vulnerabilities = asObject(asObject(parseJson(output)).vulnerabilities);
  return Object.entries(vulnerabilities)
    .map(([name, value]): Advisory => {
      const entry = asObject(value);
      const via = Array.isArray(entry.via) ? entry.via : [];
      const direct = via.map(asObject).find((item) => typeof item.title === "string");
      const origin = via.find((item) => typeof item === "string");
      return {
        package: name,
        severity: toSeverity(entry.severity),
        title: text(direct?.title) ?? (origin ? `via ${origin}` : name),
        url: safeUrl(direct?.url),
        range: text(entry.range),
      };
    })
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.package.localeCompare(b.package, "en"));
}

/** `pnpm audit --json`: advisories by id. */
export function parsePnpmAudit(output: string): Advisory[] {
  return Object.values(asObject(asObject(parseJson(output)).advisories))
    .map(asObject)
    .map((entry) => ({
      package: text(entry.module_name) ?? "?",
      severity: toSeverity(entry.severity),
      title: text(entry.title) ?? "",
      url: safeUrl(entry.url),
      range: text(entry.vulnerable_versions),
    }))
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.package.localeCompare(b.package, "en"));
}

/** `yarn audit --json` (classic): lines of JSON, one `auditAdvisory` per finding. */
export function parseYarnAudit(output: string): Advisory[] {
  const found: Advisory[] = [];
  for (const line of output.split("\n")) {
    const row = asObject(parseJson(line));
    if (row.type !== "auditAdvisory") continue;
    const advisory = asObject(asObject(row.data).advisory);
    found.push({
      package: text(advisory.module_name) ?? "?",
      severity: toSeverity(advisory.severity),
      title: text(advisory.title) ?? "",
      url: safeUrl(advisory.url),
      range: text(advisory.vulnerable_versions),
    });
  }
  return found.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.package.localeCompare(b.package, "en"));
}

/** `composer outdated --direct --format=json`. */
export function parseComposerOutdated(output: string, devNames: ReadonlySet<string> = new Set()): OutdatedPackage[] {
  const installed = asObject(parseJson(output)).installed;
  if (!Array.isArray(installed)) return [];
  return installed
    .map(asObject)
    .filter((item) => item["latest-status"] !== "up-to-date" && typeof item.name === "string")
    .map((item) => outdatedFrom(String(item.name), item.version, null, item.latest, devNames.has(String(item.name))))
    .sort(byName);
}

/** `composer audit --format=json`: advisories by package. */
export function parseComposerAudit(output: string): Advisory[] {
  const found: Advisory[] = [];
  for (const [name, list] of Object.entries(asObject(asObject(parseJson(output)).advisories))) {
    for (const value of Array.isArray(list) ? list : []) {
      const advisory = asObject(value);
      found.push({
        package: name,
        // Composer often does not grade an advisory: it is then shown as a plain information.
        severity: toSeverity(advisory.severity),
        title: text(advisory.title) ?? text(advisory.cve) ?? "",
        url: safeUrl(advisory.link),
        range: text(advisory.affectedVersions),
      });
    }
  }
  return found.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.package.localeCompare(b.package, "en"));
}
