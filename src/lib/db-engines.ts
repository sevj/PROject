export const ENGINES = ["postgres", "mysql", "mariadb", "mongodb"] as const;
export type Engine = (typeof ENGINES)[number];

export const ENGINE_LABELS: Record<Engine, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mongodb: "MongoDB",
};

/** Tools that talk to a database, rather than being one: their image name says "postgres" too. */
const NOT_A_SERVER = /exporter|admin|backup|proxy|bouncer|client|operator|dump|express|compass|migrate|init/;

const BY_IMAGE: [Engine, RegExp][] = [
  ["mariadb", /mariadb/],
  ["mysql", /mysql|percona/],
  ["postgres", /postgres|postgis|timescale|pgvector/],
  ["mongodb", /mongo/],
];

/** For an image built on top of a database image, whose name does not say so. */
const BY_ENV: [Engine, RegExp][] = [
  ["postgres", /^(POSTGRES_(USER|PASSWORD|DB)$|POSTGRESQL_)/],
  ["mariadb", /^MARIADB_/],
  ["mysql", /^MYSQL_(ROOT_PASSWORD|DATABASE|USER|PASSWORD|ALLOW_EMPTY_PASSWORD|RANDOM_ROOT_PASSWORD)$/],
  ["mongodb", /^MONGO_INITDB_/],
];

const DATABASE_SERVICE = /(^|[-_.])(db|database|sql|pg|postgres|postgresql|mysql|maria|mariadb|mongo|mongodb)([-_.\d]|$)/i;

/**
 * The image decides. Variables only count for a container that is called like a database,
 * because an application sharing the project's `.env` carries the same credentials.
 */
export function detectEngine({
  image,
  service = "",
  envKeys = [],
}: {
  image: string;
  service?: string;
  envKeys?: string[];
}): Engine | null {
  const name = image.toLowerCase().split("@")[0].replace(/:[^/:]*$/, "");
  if (NOT_A_SERVER.test(name)) return null;
  const byImage = BY_IMAGE.find(([, pattern]) => pattern.test(name));
  if (byImage) return byImage[0];
  if (!DATABASE_SERVICE.test(service)) return null;
  return BY_ENV.find(([, pattern]) => envKeys.some((key) => pattern.test(key)))?.[0] ?? null;
}

/** A dump of one can be loaded into the other, as long as it sticks to what they share. */
export function isCompatible(dump: Engine, target: Engine): boolean {
  const family = (engine: Engine) => (engine === "mariadb" ? "mysql" : engine);
  return family(dump) === family(target);
}

/** It ends up quoted in a statement: only names that need no care are let through. */
export function isValidDatabaseName(name: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_$.-]{0,62}$/.test(name);
}

export const DUMP_EXTENSION: Record<Engine, string> = {
  postgres: "sql",
  mysql: "sql",
  mariadb: "sql",
  mongodb: "archive",
};
