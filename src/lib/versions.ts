/** What endoflife.date follows, by its own product names. */
export const PRODUCTS = ["php", "symfony", "drupal", "laravel", "nodejs", "mysql", "mariadb", "postgresql", "mongodb", "redis"] as const;
export type Product = (typeof PRODUCTS)[number];

export const PRODUCT_LABELS: Record<Product, string> = {
  php: "PHP",
  symfony: "Symfony",
  drupal: "Drupal",
  laravel: "Laravel",
  nodejs: "Node",
  mysql: "MySQL",
  mariadb: "MariaDB",
  postgresql: "PostgreSQL",
  mongodb: "MongoDB",
  redis: "Redis",
};

/** Where a version was read, which says how sure it is: an image runs it, a constraint only allows it. */
export type VersionSource = "image" | "lock" | "nvmrc" | "constraint";
export type FoundVersion = { product: Product; version: string; source: VersionSource; from: string };

const leading = (text: string) => /^v?(\d+(?:\.\d+){0,2})/.exec(text.trim())?.[1] ?? null;

/** The image's own name, without registry nor owner: `wodby/php` and `php` are both PHP. */
const IMAGES: [RegExp, Product][] = [
  [/(^|[-_])php([-_]|$)/, "php"],
  [/^node$/, "nodejs"],
  [/^mysql$/, "mysql"],
  [/^mariadb$/, "mariadb"],
  [/^postgres(ql)?$/, "postgresql"],
  [/^mongo(db)?$/, "mongodb"],
  [/^redis$/, "redis"],
  [/^drupal$/, "drupal"],
];

export function fromImage(name: string, tag: string): FoundVersion | null {
  const base = name.toLowerCase().split("/").at(-1) ?? "";
  const product = IMAGES.find(([pattern]) => pattern.test(base))?.[1];
  const version = leading(tag);
  return product && version ? { product, version, source: "image", from: `${name}:${tag}` } : null;
}

/** "^8.1", ">=8.2 <8.4", "~7.4.0 || ^8.0": the lowest version it allows. */
export function lowestAllowed(constraint: string): string | null {
  // Whole versions, cut to their line: "7.4.0" is 7.4, not 7.4 and 0.
  const versions = [...constraint.matchAll(/\d+(?:\.\d+)*/g)].map(([value]) => value.split(".").slice(0, 2).join("."));
  if (versions.length === 0) return null;
  return versions.sort((a, b) => compareVersions(a, b))[0];
}

export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

const LOCKED: [string, Product][] = [
  ["symfony/framework-bundle", "symfony"],
  ["symfony/http-kernel", "symfony"],
  ["drupal/core", "drupal"],
  ["drupal/core-recommended", "drupal"],
  ["laravel/framework", "laravel"],
];

/** The versions installed, from composer.lock's packages. */
export function fromComposerLock(lock: unknown): FoundVersion[] {
  const packages = lock && typeof lock === "object" ? (lock as { packages?: unknown }).packages : null;
  if (!Array.isArray(packages)) return [];
  const found = new Map<Product, FoundVersion>();
  for (const [name, product] of LOCKED) {
    if (found.has(product)) continue;
    const item = packages.find((entry) => entry && typeof entry === "object" && (entry as { name?: unknown }).name === name) as { version?: unknown } | undefined;
    const version = typeof item?.version === "string" ? leading(item.version) : null;
    if (version) found.set(product, { product, version, source: "lock", from: `composer.lock · ${name}` });
  }
  return [...found.values()];
}

/** The PHP that composer.json asks for, when nothing says which one runs. */
export function fromComposerJson(manifest: unknown): FoundVersion[] {
  const php = manifest && typeof manifest === "object" ? (manifest as { require?: Record<string, unknown> }).require?.php : null;
  const version = typeof php === "string" ? lowestAllowed(php) : null;
  return version ? [{ product: "php", version, source: "constraint", from: `composer.json · php ${php}` }] : [];
}

export function fromNvmrc(content: string): FoundVersion[] {
  const version = leading(content);
  return version ? [{ product: "nodejs", version, source: "nvmrc", from: ".nvmrc" }] : [];
}

export function fromPackageJson(manifest: unknown): FoundVersion[] {
  const engine = manifest && typeof manifest === "object" ? (manifest as { engines?: Record<string, unknown> }).engines?.node : null;
  const version = typeof engine === "string" ? lowestAllowed(engine) : null;
  return version ? [{ product: "nodejs", version, source: "constraint", from: `package.json · engines.node ${engine}` }] : [];
}

const TRUST: Record<VersionSource, number> = { image: 0, lock: 0, nvmrc: 1, constraint: 2 };

/** One per product, the surest first: what runs or is installed, before what is only allowed. */
export function bestVersions(found: FoundVersion[]): FoundVersion[] {
  const best = new Map<Product, FoundVersion>();
  for (const item of found) {
    const known = best.get(item.product);
    if (!known || TRUST[item.source] < TRUST[known.source]) best.set(item.product, item);
  }
  return PRODUCTS.flatMap((product) => best.get(product) ?? []);
}

/** A release line of endoflife.date, the dates as it writes them (YYYY-MM-DD). */
export type Release = { name: string; eoasFrom: string | null; eolFrom: string | null; latest: string | null; isLts: boolean };

/** "8.3.12" is in the 8.3 line, "22.4" in the 22 one: the closest line by name. */
export function releaseOf(version: string, releases: Release[]): Release | null {
  const parts = version.split(".");
  for (let length = parts.length; length >= 1; length--) {
    const name = parts.slice(0, length).join(".");
    const release = releases.find((item) => item.name === name);
    if (release) return release;
  }
  // "redis:7" pulls the newest 7.x: its newest known line.
  const within = releases.filter((item) => item.name.startsWith(`${version}.`));
  return within.sort((a, b) => compareVersions(b.name, a.name))[0] ?? null;
}

export type SupportState = "active" | "security" | "soon" | "eol" | "unknown";

const DAY = 86_400_000;
/** Ending within six months is a matter for the next quote. */
export const SOON_DAYS = 183;

export function supportOf(release: Release | null, now: number): SupportState {
  if (!release) return "unknown";
  const eol = release.eolFrom ? Date.parse(release.eolFrom) : null;
  if (eol !== null && eol <= now) return "eol";
  if (eol !== null && eol - now <= SOON_DAYS * DAY) return "soon";
  const eoas = release.eoasFrom ? Date.parse(release.eoasFrom) : null;
  if (eoas !== null && eoas <= now) return "security";
  return "active";
}

/** The worst first, to sort the projects by what needs doing. */
export const SUPPORT_ORDER: SupportState[] = ["eol", "soon", "security", "unknown", "active"];

/** endoflife.date's v1 answer, kept to what is used; null when it is not that. */
export function parseReleases(answer: unknown): Release[] | null {
  const releases = (answer as { result?: { releases?: unknown } } | null)?.result?.releases;
  if (!Array.isArray(releases)) return null;
  const date = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  return releases.flatMap((item) => {
    if (!item || typeof item !== "object" || typeof (item as { name?: unknown }).name !== "string") return [];
    const raw = item as { name: string; eoasFrom?: unknown; eolFrom?: unknown; latest?: { name?: unknown } | null; isLts?: unknown };
    return [
      {
        name: raw.name,
        eoasFrom: date(raw.eoasFrom),
        eolFrom: date(raw.eolFrom),
        latest: typeof raw.latest?.name === "string" ? raw.latest.name : null,
        isLts: raw.isLts === true,
      },
    ];
  });
}
