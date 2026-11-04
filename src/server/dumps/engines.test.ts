import { describe, expect, it } from "vitest";
import {
  dumpCommand,
  ensureDatabaseCommand,
  estimateCommand,
  listDatabasesCommand,
  parseDatabases,
  parseEstimate,
  readCredentials,
  restoreCommand,
  secretsFor,
} from "./engines";

describe("readCredentials", () => {
  it("reads PostgreSQL's own variables, with the usual defaults", () => {
    expect(readCredentials("postgres", { POSTGRES_USER: "app", POSTGRES_PASSWORD: "pw", POSTGRES_DB: "shop" })).toEqual({
      user: "app",
      password: "pw",
      database: "shop",
    });
    expect(readCredentials("postgres", {})).toEqual({ user: "postgres", password: null, database: "postgres" });
    expect(readCredentials("postgres", { POSTGRESQL_USERNAME: "u", POSTGRESQL_PASSWORD: "p" })).toMatchObject({ user: "u", password: "p" });
  });

  it("prefers the root account for MySQL and MariaDB, and falls back on the application's", () => {
    expect(readCredentials("mysql", { MYSQL_ROOT_PASSWORD: "root", MYSQL_USER: "app", MYSQL_PASSWORD: "x", MYSQL_DATABASE: "shop" })).toEqual({
      user: "root",
      password: "root",
      database: "shop",
    });
    expect(readCredentials("mysql", { MYSQL_USER: "app", MYSQL_PASSWORD: "x" })).toMatchObject({ user: "app", password: "x" });
    expect(readCredentials("mysql", { MYSQL_ALLOW_EMPTY_PASSWORD: "yes" })).toMatchObject({ user: "root", password: null });
    expect(readCredentials("mariadb", { MARIADB_ROOT_PASSWORD: "m", MYSQL_ROOT_PASSWORD: "y" })).toMatchObject({ password: "m" });
    expect(readCredentials("mariadb", { MYSQL_ROOT_PASSWORD: "y" })).toMatchObject({ password: "y" });
    expect(readCredentials("mysql", { MYSQL_ROOT_PASSWORD: "" })).toMatchObject({ user: "root", password: null });
  });

  it("reads MongoDB's root account", () => {
    expect(readCredentials("mongodb", { MONGO_INITDB_ROOT_USERNAME: "root", MONGO_INITDB_ROOT_PASSWORD: "pw" })).toMatchObject({
      user: "root",
      password: "pw",
    });
    expect(readCredentials("mongodb", {})).toMatchObject({ user: "", password: null });
  });

  it("lets what the person typed win", () => {
    expect(readCredentials("postgres", { POSTGRES_PASSWORD: "env" }, { user: "me", password: "typed" })).toMatchObject({ user: "me", password: "typed" });
    expect(readCredentials("mysql", { MYSQL_ROOT_PASSWORD: "env" }, { user: "me", password: "typed" })).toMatchObject({ user: "me", password: "typed" });
    expect(readCredentials("mysql", { MYSQL_ROOT_PASSWORD: "env" }, { password: "typed" })).toMatchObject({ user: "root", password: "typed" });
  });
});

describe("secrets", () => {
  it("go through the environment, under the name each client reads", () => {
    expect(secretsFor("postgres", { user: "u", password: "pw", database: null })).toEqual({ PGPASSWORD: "pw" });
    expect(secretsFor("mysql", { user: "u", password: "pw", database: null })).toEqual({ MYSQL_PWD: "pw" });
    expect(secretsFor("mariadb", { user: "u", password: "pw", database: null })).toEqual({ MYSQL_PWD: "pw" });
    expect(secretsFor("postgres", { user: "u", password: null, database: null })).toEqual({});
  });

  it("never appear in a command line, except MongoDB's, which has no other way", () => {
    const secretive = { user: "u", password: "s3cret", database: null };
    for (const engine of ["postgres", "mysql", "mariadb"] as const) {
      for (const command of [
        listDatabasesCommand(engine, secretive),
        estimateCommand(engine, secretive, "shop"),
        dumpCommand(engine, secretive, "shop"),
        restoreCommand(engine, secretive, { source: "shop", target: "shop" }),
        ensureDatabaseCommand(engine, secretive, "shop"),
      ]) {
        expect(JSON.stringify(command?.args)).not.toContain("s3cret");
      }
    }
    expect(dumpCommand("mongodb", secretive, null).args).toContain("s3cret");
  });
});

describe("PostgreSQL commands", () => {
  const credentials = { user: "app", password: "pw", database: "shop" };

  it("dumps one database as portable text, or all of them with their roles", () => {
    expect(dumpCommand("postgres", credentials, "shop").args).toEqual([
      "pg_dump", "-U", "app", "-d", "shop", "--clean", "--if-exists", "--no-owner", "--no-acl",
    ]);
    expect(dumpCommand("postgres", credentials, null).args).toEqual(["pg_dumpall", "-U", "app", "--clean", "--if-exists"]);
  });

  it("loads into the named database, or the maintenance one for a full dump", () => {
    expect(restoreCommand("postgres", credentials, { source: "shop", target: "copy" }).args).toEqual(["psql", "-U", "app", "-d", "copy", "-X", "-q"]);
    expect(restoreCommand("postgres", credentials, { source: null, target: null }).args).toContain("postgres");
  });

  it("creates the target when it does not exist, through the script it reads", () => {
    const command = ensureDatabaseCommand("postgres", credentials, "copy");
    expect(command?.stdin).toContain('CREATE DATABASE "copy"');
    expect(command?.stdin).toContain("WHERE NOT EXISTS");
    expect(command?.stdin).toContain("\\gexec");
  });

  it("lists the databases that can be dumped, and sizes one or all", () => {
    expect(listDatabasesCommand("postgres", credentials).args.at(-1)).toContain("NOT datistemplate");
    expect(estimateCommand("postgres", credentials, "shop").args.at(-1)).toBe("SELECT pg_database_size('shop')");
    expect(estimateCommand("postgres", credentials, null).args.at(-1)).toContain("sum(pg_database_size");
  });
});

describe("MySQL and MariaDB commands", () => {
  const credentials = { user: "root", password: "pw", database: null };
  const script = (command: { args: string[] }) => command.args.slice(6);

  it("looks for the client under both names, in the order of the server", () => {
    expect(dumpCommand("mysql", credentials, "shop").args.slice(0, 6)).toEqual(["sh", "-c", expect.any(String), "sh", "mysqldump", "mariadb-dump"]);
    expect(dumpCommand("mariadb", credentials, "shop").args.slice(3, 6)).toEqual(["sh", "mariadb-dump", "mysqldump"]);
    expect(restoreCommand("mariadb", credentials, { source: null, target: "shop" }).args.slice(3, 6)).toEqual(["sh", "mariadb", "mysql"]);
  });

  it("dumps consistently, with the options only MySQL's tool knows kept to it", () => {
    expect(script(dumpCommand("mysql", credentials, "shop"))).toEqual([
      "-u", "root", "--single-transaction", "--routines", "--triggers", "--events", "--set-gtid-purged=OFF", "shop",
    ]);
    expect(script(dumpCommand("mariadb", credentials, "shop"))).not.toContain("--set-gtid-purged=OFF");
    expect(script(dumpCommand("mysql", { ...credentials, user: "app" }, null))).toEqual(expect.arrayContaining(["--no-tablespaces", "--all-databases"]));
  });

  it("creates the target, loads into it, and sizes the data", () => {
    expect(ensureDatabaseCommand("mysql", credentials, "copy")?.args.at(-1)).toBe("CREATE DATABASE IF NOT EXISTS `copy`");
    expect(script(restoreCommand("mysql", credentials, { source: "shop", target: "copy" }))).toEqual(["-u", "root", "copy"]);
    expect(script(restoreCommand("mysql", credentials, { source: null, target: null }))).toEqual(["-u", "root"]);
    expect(estimateCommand("mysql", credentials, "shop").args.at(-1)).toContain("table_schema = 'shop'");
    expect(estimateCommand("mysql", credentials, null).args.at(-1)).toContain("NOT IN");
  });
});

describe("MongoDB commands", () => {
  const credentials = { user: "root", password: "pw", database: null };

  it("dumps an archive, of one database or all", () => {
    expect(dumpCommand("mongodb", credentials, "shop").args).toEqual([
      "mongodump", "--archive", "--username", "root", "--password", "pw", "--authenticationDatabase", "admin", "--db", "shop",
    ]);
    expect(dumpCommand("mongodb", { user: "", password: null, database: null }, null).args).toEqual(["mongodump", "--archive"]);
  });

  it("replaces what is there, and renames the database only when asked to", () => {
    expect(restoreCommand("mongodb", credentials, { source: "shop", target: "shop" }).args).not.toContain("--nsFrom");
    expect(restoreCommand("mongodb", credentials, { source: "shop", target: "copy" }).args).toEqual(
      expect.arrayContaining(["--drop", "--nsFrom", "shop.*", "--nsTo", "copy.*"]),
    );
    expect(ensureDatabaseCommand("mongodb", credentials, "copy")).toBeNull();
  });
});

describe("parsers", () => {
  it("keeps the databases a person would dump", () => {
    expect(parseDatabases("mysql", "information_schema\nmysql\nperformance_schema\nshop\nsys\nblog\n")).toEqual(["shop", "blog"]);
    expect(parseDatabases("postgres", "app\nshop\n")).toEqual(["app", "shop"]);
    expect(parseDatabases("mongodb", "admin\nconfig\nlocal\nshop\n")).toEqual(["shop"]);
    expect(parseDatabases("postgres", "ok\nbad name\n\n")).toEqual(["ok"]);
  });

  it("reads a size, or says there is none", () => {
    expect(parseEstimate("123456\n")).toBe(123456);
    expect(parseEstimate("warning\n42\n")).toBe(42);
    expect(parseEstimate("")).toBeNull();
    expect(parseEstimate("nope")).toBeNull();
  });

  it("refuses a database name that would need care", () => {
    const credentials = { user: "u", password: null, database: null };
    expect(() => dumpCommand("postgres", credentials, "a;b")).toThrow("Invalid database name");
    expect(() => estimateCommand("mysql", credentials, "a'b")).toThrow();
    expect(() => restoreCommand("mysql", credentials, { source: null, target: "a`b" })).toThrow();
  });
});
