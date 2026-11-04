import { type Engine, isValidDatabaseName } from "@/lib/db-engines";

export type CredentialOverride = { user?: string; password?: string };

export type Credentials = {
  user: string;
  password: string | null;
  /** What the container's own variables name as its main database. */
  database: string | null;
};

/**
 * A program to run in the container. Secrets travel as environment variables, which the
 * client is told to pass on by name: they never appear in a command line.
 */
export type Command = { args: string[]; secrets?: Record<string, string>; stdin?: string };

const firstDefined = (...values: (string | undefined)[]) => values.find((value) => value !== undefined);

/** From the container's own variables, unless the person says otherwise. */
export function readCredentials(
  engine: Engine,
  env: Record<string, string>,
  override: CredentialOverride = {},
): Credentials {
  if (engine === "postgres") {
    const user = override.user || firstDefined(env.POSTGRES_USER, env.POSTGRESQL_USERNAME) || "postgres";
    const password =
      override.password ??
      firstDefined(env.POSTGRES_PASSWORD, env.POSTGRESQL_PASSWORD, user === "postgres" ? env.POSTGRESQL_POSTGRES_PASSWORD : undefined) ??
      null;
    return { user, password: password || null, database: firstDefined(env.POSTGRES_DB, env.POSTGRESQL_DATABASE) ?? user };
  }

  if (engine === "mongodb") {
    return {
      user: override.user || env.MONGO_INITDB_ROOT_USERNAME || "",
      password: override.password ?? env.MONGO_INITDB_ROOT_PASSWORD ?? null,
      database: env.MONGO_INITDB_DATABASE ?? null,
    };
  }

  const prefixes = engine === "mariadb" ? ["MARIADB_", "MYSQL_"] : ["MYSQL_"];
  const get = (key: string) => firstDefined(...prefixes.map((prefix) => env[prefix + key]));
  const database = get("DATABASE") ?? null;
  if (override.user) return { user: override.user, password: override.password || null, database };
  const root = get("ROOT_PASSWORD");
  if (root !== undefined) return { user: "root", password: override.password ?? (root || null), database };
  const [user, password] = [get("USER"), get("PASSWORD")];
  if (user && password) return { user, password: override.password ?? password, database };
  return { user: "root", password: override.password || null, database };
}

export function secretsFor(engine: Engine, { password }: Credentials): Record<string, string> {
  if (!password) return {};
  if (engine === "postgres") return { PGPASSWORD: password };
  if (engine === "mongodb") return {};
  return { MYSQL_PWD: password };
}

function assertName(name: string): string {
  if (!isValidDatabaseName(name)) throw new Error(`Invalid database name: ${name}`);
  return name;
}

/** The client has a different name from one image to the next: the first one found is used. */
const PICK_TOOL =
  'tool=$(command -v "$1" || command -v "$2") || { echo "no database client found in this container" >&2; exit 127; }; shift 2; exec "$tool" "$@"';
const pickTool = (first: string, second: string, args: string[]) => ["sh", "-c", PICK_TOOL, "sh", first, second, ...args];

const SQL_SYSTEM_DATABASES = new Set(["information_schema", "performance_schema", "mysql", "sys"]);
const MONGO_SYSTEM_DATABASES = new Set(["admin", "local", "config"]);

const mysqlTool = (engine: Engine, kind: "client" | "dump", args: string[]) => {
  const names = kind === "client" ? ["mysql", "mariadb"] : ["mysqldump", "mariadb-dump"];
  return pickTool(...((engine === "mariadb" ? names.reverse() : names) as [string, string]), args);
};

const mongoAuth = ({ user, password }: Credentials) =>
  user && password ? ["--username", user, "--password", password, "--authenticationDatabase", "admin"] : [];

const mongoEval = (credentials: Credentials, script: string) =>
  pickTool("mongosh", "mongo", ["--quiet", ...mongoAuth(credentials), "--eval", script]);

const psql = (credentials: Credentials, extra: string[]) => ["psql", "-U", credentials.user, "-d", "postgres", "-X", ...extra];

export function listDatabasesCommand(engine: Engine, credentials: Credentials): Command {
  const secrets = secretsFor(engine, credentials);
  if (engine === "postgres") {
    return {
      args: psql(credentials, [
        "-A",
        "-t",
        "-c",
        "SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname",
      ]),
      secrets,
    };
  }
  if (engine === "mongodb") {
    return {
      args: mongoEval(credentials, 'print(db.adminCommand({listDatabases: 1}).databases.map(function (d) { return d.name; }).join("\\n"))'),
    };
  }
  return { args: mysqlTool(engine, "client", ["-u", credentials.user, "-N", "-B", "-e", "SHOW DATABASES"]), secrets };
}

export function parseDatabases(engine: Engine, stdout: string): string[] {
  const hidden = engine === "mongodb" ? MONGO_SYSTEM_DATABASES : engine === "postgres" ? new Set<string>() : SQL_SYSTEM_DATABASES;
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((name) => name !== "" && !hidden.has(name) && isValidDatabaseName(name));
}

/** Roughly what the dump will weigh: the size of the data, which is the best guess to hand. */
export function estimateCommand(engine: Engine, credentials: Credentials, database: string | null): Command {
  const secrets = secretsFor(engine, credentials);
  const name = database === null ? null : assertName(database);
  if (engine === "postgres") {
    return {
      args: psql(credentials, [
        "-A",
        "-t",
        "-c",
        name === null
          ? "SELECT COALESCE(sum(pg_database_size(datname)), 0) FROM pg_database"
          : `SELECT pg_database_size('${name}')`,
      ]),
      secrets,
    };
  }
  if (engine === "mongodb") {
    return {
      args: mongoEval(
        credentials,
        name === null ? "print(db.adminCommand({listDatabases: 1}).totalSize)" : `print(db.getSiblingDB("${name}").stats().dataSize)`,
      ),
    };
  }
  const scope = name === null ? "table_schema NOT IN ('information_schema','performance_schema','mysql','sys')" : `table_schema = '${name}'`;
  return {
    args: mysqlTool(engine, "client", [
      "-u",
      credentials.user,
      "-N",
      "-B",
      "-e",
      `SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE ${scope}`,
    ]),
    secrets,
  };
}

export function parseEstimate(stdout: string): number | null {
  const last = stdout.trim().split(/\r?\n/).at(-1) ?? "";
  // An empty answer is not a size of zero.
  if (last === "") return null;
  const value = Number(last);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/** Plain text a person can read, which any server of the same kind can load. */
export function dumpCommand(engine: Engine, credentials: Credentials, database: string | null): Command {
  const secrets = secretsFor(engine, credentials);
  const name = database === null ? null : assertName(database);
  if (engine === "postgres") {
    return {
      args:
        name === null
          ? ["pg_dumpall", "-U", credentials.user, "--clean", "--if-exists"]
          : ["pg_dump", "-U", credentials.user, "-d", name, "--clean", "--if-exists", "--no-owner", "--no-acl"],
      secrets,
    };
  }
  if (engine === "mongodb") {
    return { args: ["mongodump", "--archive", ...mongoAuth(credentials), ...(name === null ? [] : ["--db", name])] };
  }
  const options = [
    "-u",
    credentials.user,
    "--single-transaction",
    "--routines",
    "--triggers",
    "--events",
    // Options that only one of the two servers' tools knows.
    ...(engine === "mysql" ? ["--set-gtid-purged=OFF", ...(credentials.user === "root" ? [] : ["--no-tablespaces"])] : []),
    ...(name === null ? ["--all-databases"] : [name]),
  ];
  return { args: mysqlTool(engine, "dump", options), secrets };
}

/** What has to exist before a dump can be loaded into a database of that name. */
export function ensureDatabaseCommand(engine: Engine, credentials: Credentials, database: string): Command | null {
  const secrets = secretsFor(engine, credentials);
  const name = assertName(database);
  if (engine === "postgres") {
    return {
      args: psql(credentials, ["-q"]),
      secrets,
      stdin: `SELECT 'CREATE DATABASE "${name}"' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${name}')\\gexec\n`,
    };
  }
  if (engine === "mongodb") return null;
  return { args: mysqlTool(engine, "client", ["-u", credentials.user, "-e", `CREATE DATABASE IF NOT EXISTS \`${name}\``]), secrets };
}

/** `source` is the database the dump came from, `target` the one to load it into. */
export function restoreCommand(
  engine: Engine,
  credentials: Credentials,
  { source, target }: { source: string | null; target: string | null },
): Command {
  const secrets = secretsFor(engine, credentials);
  const name = target === null ? null : assertName(target);
  if (engine === "postgres") {
    return { args: ["psql", "-U", credentials.user, "-d", name ?? "postgres", "-X", "-q"], secrets };
  }
  if (engine === "mongodb") {
    const rename =
      source !== null && name !== null && source !== name ? ["--nsFrom", `${assertName(source)}.*`, "--nsTo", `${name}.*`] : [];
    return { args: ["mongorestore", "--archive", "--drop", ...mongoAuth(credentials), ...rename] };
  }
  return { args: mysqlTool(engine, "client", ["-u", credentials.user, ...(name === null ? [] : [name])]), secrets };
}
