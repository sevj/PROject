import { describe, expect, it } from "vitest";
import { checkExplainableSql, checkMongoFilter, checkReadOnlySql, quoteIdentifier, quoteTable } from "./sql-guard";

const pg = (sql: string) => checkReadOnlySql(sql, "postgres");
const my = (sql: string) => checkReadOnlySql(sql, "mysql");

describe("checkReadOnlySql", () => {
  it.each(["SELECT 1", "  select * from users;", "WITH a AS (SELECT 1) SELECT * FROM a", "SHOW TABLES", "EXPLAIN SELECT 1", "DESCRIBE users", "TABLE users", "VALUES (1)"])(
    "accepts %s",
    (sql) => {
      expect(pg(sql).ok).toBe(true);
    },
  );

  it.each(["INSERT INTO a VALUES (1)", "UPDATE a SET b = 1", "DELETE FROM a", "DROP TABLE a", "CREATE TABLE a (b int)", "TRUNCATE a", "SET default_transaction_read_only = off", "BEGIN", "COMMIT", "CALL x()", "COPY a TO PROGRAM 'x'"])(
    "refuses %s",
    (sql) => {
      expect(pg(sql)).toEqual({ ok: false, reason: "notReadOnly" });
    },
  );

  it("refuses a second statement, even after a harmless one", () => {
    expect(pg("SELECT 1; DROP TABLE a")).toEqual({ ok: false, reason: "multiple" });
    expect(pg("SELECT 1;;")).toMatchObject({ ok: true });
  });

  it("does not take a semicolon or a keyword inside a string, a name or a comment for the real thing", () => {
    expect(pg("SELECT 'a; DROP TABLE b', \"x;y\" FROM t")).toMatchObject({ ok: true });
    expect(pg("SELECT 'into' FROM t -- ; DROP TABLE a")).toMatchObject({ ok: true });
    expect(pg("SELECT /* ; delete */ 1")).toMatchObject({ ok: true });
    expect(pg("SELECT $$ a; b $$, $tag$ ; $tag$")).toMatchObject({ ok: true });
  });

  it("sees a statement hidden after a string that looks closed but is not", () => {
    expect(my("SELECT 'a\\'; DROP TABLE b; --'")).toMatchObject({ ok: true });
    expect(pg("SELECT 'a\\'; DROP TABLE b; --'")).toEqual({ ok: false, reason: "multiple" });
    expect(pg("SELECT 'open")).toEqual({ ok: false, reason: "unterminated" });
    expect(pg("SELECT /* open")).toEqual({ ok: false, reason: "unterminated" });
  });

  it("refuses INTO, which writes files or creates tables", () => {
    expect(my("SELECT * FROM t INTO OUTFILE '/tmp/x'")).toEqual({ ok: false, reason: "into" });
    expect(pg("SELECT * INTO copy FROM t")).toEqual({ ok: false, reason: "into" });
  });

  it("handles # comments for MySQL only", () => {
    expect(my("SELECT 1 # ; DROP TABLE a")).toMatchObject({ ok: true });
    expect(pg("SELECT 1 # 2")).toMatchObject({ ok: true });
  });

  it("refuses an empty query", () => {
    expect(pg("  ; ")).toEqual({ ok: false, reason: "empty" });
    expect(pg("-- nothing")).toEqual({ ok: false, reason: "empty" });
  });

  it("returns the statement without its final semicolon", () => {
    expect(pg("  SELECT 1 ;")).toEqual({ ok: true, statement: "SELECT 1" });
  });
});

describe("quoting", () => {
  it("doubles the quote character", () => {
    expect(quoteIdentifier('we"ird', "postgres")).toBe('"we""ird"');
    expect(quoteIdentifier("we`ird", "mysql")).toBe("`we``ird`");
    expect(quoteTable("public", "users", "postgres")).toBe('"public"."users"');
    expect(quoteTable(null, "users", "mariadb")).toBe("`users`");
  });
  it("refuses an empty or multi-line name", () => {
    expect(() => quoteIdentifier("", "postgres")).toThrow();
    expect(() => quoteIdentifier("a\nb", "postgres")).toThrow();
  });
});

describe("checkMongoFilter", () => {
  it("accepts an object and an empty filter", () => {
    expect(checkMongoFilter('{ "a": 1 }')).toEqual({ ok: true, filter: '{"a":1}' });
    expect(checkMongoFilter("")).toEqual({ ok: true, filter: "{}" });
  });
  it("refuses what is not an object and what runs JavaScript", () => {
    expect(checkMongoFilter("[1]")).toEqual({ ok: false, reason: "invalid" });
    expect(checkMongoFilter("{a:")).toEqual({ ok: false, reason: "invalid" });
    expect(checkMongoFilter('{"$where": "sleep(1)"}')).toEqual({ ok: false, reason: "script" });
  });
});

describe("checkExplainableSql", () => {
  it("accepts a plain read and refuses what EXPLAIN cannot describe", () => {
    expect(checkExplainableSql("SELECT 1;", "postgres")).toEqual({ ok: true, statement: "SELECT 1" });
    expect(checkExplainableSql("-- note\nWITH a AS (SELECT 1) SELECT * FROM a", "mysql").ok).toBe(true);
    expect(checkExplainableSql("EXPLAIN SELECT 1", "postgres")).toEqual({ ok: false, reason: "notReadOnly" });
    expect(checkExplainableSql("SHOW TABLES", "mysql")).toEqual({ ok: false, reason: "notReadOnly" });
    expect(checkExplainableSql("SELECT 1; DROP TABLE a", "postgres")).toEqual({ ok: false, reason: "multiple" });
    expect(checkExplainableSql("SELECT * INTO t FROM a", "postgres")).toEqual({ ok: false, reason: "into" });
  });
});
