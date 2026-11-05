import Database from "better-sqlite3";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browseSqliteTable, explainSqlite, findSqliteFiles, listSqliteColumns, listSqliteForeignKeys, listSqliteTables, runSqlite } from "./sqlite";

let root: string;
let file: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pm-sqlite-"));
  mkdirSync(join(root, "data"));
  mkdirSync(join(root, "node_modules"));
  file = join(root, "data", "app.sqlite");
  const db = new Database(file);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, avatar BLOB);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total REAL);
    CREATE INDEX idx_orders_user ON orders (user_id);
    CREATE VIEW big_orders AS SELECT * FROM orders WHERE total > 100;
  `);
  const insert = db.prepare("INSERT INTO users (name, avatar) VALUES (?, ?)");
  for (let i = 0; i < 60; i += 1) insert.run(`user ${i}`, i === 0 ? Buffer.from([1, 2, 3]) : null);
  db.close();
  // These must not be found.
  writeFileSync(join(root, "notes.db"), "not a database at all");
  copyFileSync(file, join(root, "node_modules", "x.db"));
  symlinkSync(file, join(root, "link.db"));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("foreign keys", () => {
  let keyed: string;

  beforeAll(() => {
    keyed = join(root, "keyed.sqlite");
    const db = new Database(keyed);
    db.exec(`
      CREATE TABLE teams (id INTEGER PRIMARY KEY, label TEXT);
      CREATE TABLE people (
        id INTEGER PRIMARY KEY,
        team_id INTEGER REFERENCES TEAMS,
        boss_id INTEGER REFERENCES people (id),
        nick TEXT
      );
      CREATE TABLE stock (shop INTEGER, sku TEXT, PRIMARY KEY (shop, sku));
      CREATE TABLE lines (id INTEGER PRIMARY KEY, shop INTEGER, sku TEXT, FOREIGN KEY (shop, sku) REFERENCES stock);
      INSERT INTO teams VALUES (1, 'core'), (2, 'o''hara');
      INSERT INTO people VALUES (1, 2, NULL, 'x');
    `);
    db.close();
  });

  it("reads them with real names, an implicit target and composite keys", async () => {
    const result = await listSqliteForeignKeys(keyed);
    if ("error" in result) throw new Error(result.error);
    const summary = result.foreignKeys.map(({ from, columns, to, refColumns }) => `${from.name}(${columns}) -> ${to.name}(${refColumns})`);
    expect(summary.sort()).toEqual([
      "lines(shop,sku) -> stock(shop,sku)",
      "people(boss_id) -> people(id)",
      "people(team_id) -> teams(id)",
    ]);
  });

  it("finds the designated row, whatever its value holds", async () => {
    const found = await browseSqliteTable(keyed, "teams", 0, [{ column: "id", value: "2" }]);
    expect(found).toMatchObject({ ok: true, hasMore: false });
    if (found.ok) expect(found.result.rows).toEqual([["2", "o'hara"]]);

    const quoted = await browseSqliteTable(keyed, "teams", 0, [{ column: "label", value: "o'hara" }]);
    if (quoted.ok) expect(quoted.result.rows).toHaveLength(1);

    const injected = await browseSqliteTable(keyed, "teams", 0, [{ column: "label", value: "x' OR '1'='1" }]);
    if (injected.ok) expect(injected.result.rows).toEqual([]);
  });

  it("gives nothing for a file without keys", async () => {
    expect(await listSqliteForeignKeys(file)).toEqual({ foreignKeys: [] });
  });
});

describe("findSqliteFiles", () => {
  it("finds real SQLite files, not fake ones, links or dependencies", () => {
    expect(findSqliteFiles(root)).toEqual([join("data", "app.sqlite"), "keyed.sqlite"]);
  });
});

describe("runSqlite", () => {
  it("returns columns and text cells, blobs summarized and NULL kept", async () => {
    const outcome = await runSqlite(file, "SELECT id, name, avatar FROM users ORDER BY id LIMIT 2");
    expect(outcome).toMatchObject({ ok: true, result: { columns: ["id", "name", "avatar"], truncated: false } });
    if (outcome.ok) expect(outcome.result.rows).toEqual([["1", "user 0", "<blob 3 bytes>"], ["2", "user 1", null]]);
  });

  it("cuts the rows at the limit", async () => {
    const outcome = await runSqlite(file, "SELECT * FROM users", 10);
    if (outcome.ok) {
      expect(outcome.result.rows).toHaveLength(10);
      expect(outcome.result.truncated).toBe(true);
    } else throw new Error(outcome.error);
  });

  it("refuses a write, even one that gets past the text check", async () => {
    expect(await runSqlite(file, "DELETE FROM users")).toEqual({ ok: false, error: "notReadOnly" });
    const attempt = await runSqlite(file, "INSERT INTO users (name) VALUES ('x') RETURNING id");
    expect(attempt.ok).toBe(false);
    const count = await runSqlite(file, "SELECT count(*) FROM users");
    if (count.ok) expect(count.result.rows[0][0]).toBe("60");
  });

  it("refuses two statements and reports a syntax error", async () => {
    expect((await runSqlite(file, "SELECT 1; SELECT 2")).ok).toBe(false);
    const broken = await runSqlite(file, "SELEC 1");
    expect(broken.ok).toBe(false);
  });
});

describe("tables, columns, pages and plans", () => {
  it("lists tables and views without the internal ones", async () => {
    const result = await listSqliteTables(file);
    expect(result).toEqual({
      tables: [
        { schema: null, name: "big_orders", kind: "view", estimatedRows: null },
        { schema: null, name: "orders", kind: "table", estimatedRows: null },
        { schema: null, name: "users", kind: "table", estimatedRows: null },
      ],
    });
  });

  it("describes columns", async () => {
    const result = await listSqliteColumns(file, "users");
    expect(result).toEqual({
      columns: [
        { name: "id", type: "INTEGER", nullable: true, defaultValue: null, key: "PRI" },
        { name: "name", type: "TEXT", nullable: false, defaultValue: null, key: null },
        { name: "avatar", type: "BLOB", nullable: true, defaultValue: null, key: null },
      ],
    });
  });

  it("pages through a table, and a name cannot break out of its quotes", async () => {
    const first = await browseSqliteTable(file, "users", 0);
    const second = await browseSqliteTable(file, "users", 1);
    if (!first.ok || !second.ok) throw new Error("failed");
    expect([first.result.rows.length, first.hasMore, second.result.rows.length, second.hasMore]).toEqual([50, true, 10, false]);
    expect((await browseSqliteTable(file, 'users"; DROP TABLE users; --', 0)).ok).toBe(false);
  });

  it("explains a query: an index search and a plain scan", async () => {
    const indexed = await explainSqlite(file, "SELECT * FROM orders WHERE user_id = 3");
    const scanned = await explainSqlite(file, "SELECT * FROM users WHERE name = 'a'");
    if (!indexed.ok || !scanned.ok) throw new Error("failed");
    expect(indexed.plan.root.children[0].label).toMatch(/SEARCH orders USING (COVERING )?INDEX idx_orders_user/);
    expect(indexed.plan.root.children[0].warnings).toEqual([]);
    expect(scanned.plan.root.children[0].warnings).toEqual(["sequentialScan"]);
  });
});
