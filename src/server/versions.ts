import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { inArray } from "drizzle-orm";
import { parseImage } from "./docker-stack";
import {
  bestVersions,
  type FoundVersion,
  fromComposerJson,
  fromComposerLock,
  fromImage,
  fromNvmrc,
  fromPackageJson,
  parseReleases,
  PRODUCTS,
  type Product,
  type Release,
  releaseOf,
  SUPPORT_ORDER,
  type SupportState,
  supportOf,
} from "@/lib/versions";
import type { Db } from "./db/client";
import { eolReleases, projects as projectsTable } from "./db/schema";
import { readDockerOverview } from "./docker-overview";
import { readDockerStack } from "./docker-stack";
import { getRegistry } from "./registry";

/** A composer.lock of a big Drupal site weighs a few MB; beyond that it is not one. */
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const DAY = 86_400_000;

async function readText(path: string): Promise<string | null> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size > MAX_FILE_BYTES) return null;
  return readFile(path, "utf8").catch(() => null);
}

async function readJson(path: string): Promise<unknown> {
  const text = await readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * What a project runs or installs, from its files and its containers' images. Nothing is
 * started: the images are those written in compose files and those Docker already has.
 */
export async function readProjectVersions(path: string, images: string[]): Promise<FoundVersion[]> {
  const [lock, composer, manifest, nvmrc, stack] = await Promise.all([
    readJson(join(path, "composer.lock")),
    readJson(join(path, "composer.json")),
    readJson(join(path, "package.json")),
    readText(join(path, ".nvmrc")),
    readDockerStack(path).catch(() => ({ components: [] })),
  ]);
  const declared = stack.components.flatMap(({ images: list }) => list.map(({ name, version }) => fromImage(name, version)));
  const running = images.map((reference) => {
    const { name, version } = parseImage(reference);
    return fromImage(name, version);
  });
  return bestVersions([
    ...[...declared, ...running].filter((item): item is FoundVersion => item !== null),
    ...fromComposerLock(lock),
    ...fromComposerJson(composer),
    ...(nvmrc === null ? [] : fromNvmrc(nvmrc)),
    ...fromPackageJson(manifest),
  ]);
}

export type Fetcher = (url: string) => Promise<unknown>;
const fetchJson: Fetcher = async (url) => {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
};

export type ReleaseBook = { releases: Map<Product, Release[]>; fetchedAt: number | null; failed: Product[] };

/**
 * The release lines of these products, from the copy kept in the base while it is less than a
 * day old, else from endoflife.date. Only product names are sent. A product it cannot reach
 * keeps its older copy, and is said to have failed.
 */
export async function readReleases(db: Db, products: Product[], { force = false, now = Date.now(), fetcher = fetchJson }: { force?: boolean; now?: number; fetcher?: Fetcher } = {}): Promise<ReleaseBook> {
  const kept = products.length === 0 ? [] : db.select().from(eolReleases).where(inArray(eolReleases.product, products)).all();
  const known = new Map(kept.map((row) => [row.product as Product, row]));
  const stale = products.filter((product) => force || !known.has(product) || now - (known.get(product)?.fetchedAt.getTime() ?? 0) > DAY);
  const failed: Product[] = [];
  await Promise.all(
    stale.map(async (product) => {
      const releases = parseReleases(await fetcher(`https://endoflife.date/api/v1/products/${product}`).catch(() => null));
      if (!releases) {
        failed.push(product);
        return;
      }
      const row = { product, releases, fetchedAt: new Date(now) };
      db.insert(eolReleases).values(row).onConflictDoUpdate({ target: eolReleases.product, set: { releases, fetchedAt: row.fetchedAt } }).run();
      known.set(product, row);
    }),
  );
  const dates = [...known.values()].map(({ fetchedAt }) => fetchedAt.getTime());
  return {
    releases: new Map([...known].map(([product, row]) => [product, row.releases])),
    fetchedAt: dates.length > 0 ? Math.min(...dates) : null,
    failed: failed.sort(),
  };
}

export type VersionCell = FoundVersion & { line: string | null; support: SupportState; eoasFrom: string | null; eolFrom: string | null; latest: string | null };
export type VersionRow = { id: number; name: string; parentName: string | null; cells: VersionCell[]; worst: SupportState };
export type VersionsReport = { rows: VersionRow[]; products: Product[]; fetchedAt: number | null; failed: Product[] };

export async function readVersionsReport(db: Db, options: { force?: boolean; now?: number; fetcher?: Fetcher } = {}): Promise<VersionsReport> {
  const now = options.now ?? Date.now();
  const projects = getRegistry(db).rows.filter(({ abandoned, missing }) => !abandoned && !missing);
  const overview = await readDockerOverview(db);
  const imagesOf = (id: number) => overview.groups.filter(({ projectId }) => projectId === id).flatMap(({ containers }) => containers.map(({ image }) => image));
  // A row shows its path shortened with ~: the folder is read from the base.
  const paths = new Map(db.select({ id: projectsTable.id, path: projectsTable.path }).from(projectsTable).all().map(({ id, path }) => [id, path]));
  const found = await Promise.all(projects.map(async (project) => ({ project, versions: await readProjectVersions(paths.get(project.id) ?? project.path, imagesOf(project.id)) })));
  const products = [...new Set(found.flatMap(({ versions }) => versions.map(({ product }) => product)))];
  const book = await readReleases(db, products, { ...options, now });
  const rows = found
    .filter(({ versions }) => versions.length > 0)
    .map(({ project, versions }) => {
      const cells = versions.map((version): VersionCell => {
        const release = releaseOf(version.version, book.releases.get(version.product) ?? []);
        return { ...version, line: release?.name ?? null, support: supportOf(release, now), eoasFrom: release?.eoasFrom ?? null, eolFrom: release?.eolFrom ?? null, latest: release?.latest ?? null };
      });
      const worst = SUPPORT_ORDER.find((state) => cells.some(({ support }) => support === state)) ?? "unknown";
      return { id: project.id, name: project.name, parentName: project.parentName, cells, worst };
    })
    .sort((a, b) => SUPPORT_ORDER.indexOf(a.worst) - SUPPORT_ORDER.indexOf(b.worst) || a.name.localeCompare(b.name, "fr"));
  return { rows, products: PRODUCTS.filter((product) => products.includes(product)), fetchedAt: book.fetchedAt, failed: book.failed };
}
