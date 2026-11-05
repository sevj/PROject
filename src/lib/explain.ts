/** A query plan, whatever the database: a tree of steps with what the database estimated or measured. */
export type PlanWarning = "sequentialScan" | "badEstimate" | "heavyFilter" | "filesort" | "temporaryTable";

export type PlanNode = {
  label: string;
  /** Table, index, condition: one short line each. */
  details: string[];
  /** Cost of this step and everything under it, in the database's own unit. */
  cost: number | null;
  /** Rows the database expected. */
  rows: number | null;
  /** Rows really produced (ANALYZE only). */
  actualRows: number | null;
  /** Time spent in this step and under it, in ms (ANALYZE only). */
  timeMs: number | null;
  /** Share of the whole plan spent in this step alone, from 0 to 1. Null when the database does not say. */
  share: number | null;
  warnings: PlanWarning[];
  children: PlanNode[];
};

export type Plan = {
  root: PlanNode;
  analyzed: boolean;
  planningMs: number | null;
  executionMs: number | null;
};

/** A scan of this many rows or more, with nothing to narrow it, is worth a look. */
export const BIG_SCAN_ROWS = 10_000;
/** Expected and real rows more than this many times apart: the statistics are off. */
export const ESTIMATE_RATIO = 10;

const num = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

const sum = (values: (number | null)[]) => values.reduce<number>((total, value) => total + (value ?? 0), 0);

/** Fills `share`: the part of the whole that a step accounts for by itself, not counting its children. */
function applyShares(root: PlanNode, measure: (node: PlanNode) => number | null): void {
  const total = measure(root);
  const visit = (node: PlanNode) => {
    const own = measure(node);
    const below = sum(node.children.map(measure));
    node.share = total !== null && own !== null && total > 0 ? Math.min(1, Math.max(0, own - below) / total) : null;
    node.children.forEach(visit);
  };
  visit(root);
}

// ---- PostgreSQL: EXPLAIN (FORMAT JSON) ----

function postgresNode(raw: Record<string, unknown>): PlanNode {
  const type = text(raw["Node Type"]) ?? "?";
  const relation = text(raw["Relation Name"]);
  const alias = text(raw["Alias"]);
  const index = text(raw["Index Name"]);
  const details: string[] = [];
  if (relation) details.push(alias && alias !== relation ? `${relation} (${alias})` : relation);
  if (index) details.push(`index ${index}`);
  for (const key of ["Index Cond", "Hash Cond", "Merge Cond", "Join Filter", "Filter", "Sort Key", "Group Key"]) {
    const value = raw[key];
    const line = Array.isArray(value) ? value.filter((v) => typeof v === "string").join(", ") : text(value);
    if (line) details.push(`${key.toLowerCase()}: ${line}`);
  }
  const join = text(raw["Join Type"]);
  const loops = num(raw["Actual Loops"]);
  const actualTime = num(raw["Actual Total Time"]);
  const actualRows = num(raw["Actual Rows"]);
  const estimated = num(raw["Plan Rows"]);

  const warnings: PlanWarning[] = [];
  if (type === "Seq Scan" && (estimated ?? 0) >= BIG_SCAN_ROWS) warnings.push("sequentialScan");
  if (actualRows !== null && estimated !== null && loops !== null) {
    const real = actualRows;
    const ratio = Math.max(real, 1) / Math.max(estimated, 1);
    if (ratio >= ESTIMATE_RATIO || ratio <= 1 / ESTIMATE_RATIO) warnings.push("badEstimate");
  }
  const removed = num(raw["Rows Removed by Filter"]);
  if (removed !== null && actualRows !== null && removed >= BIG_SCAN_ROWS && removed > actualRows * ESTIMATE_RATIO) {
    warnings.push("heavyFilter");
    details.push(`${removed} rows removed by the filter`);
  }

  const children = Array.isArray(raw["Plans"])
    ? raw["Plans"].map(record).filter((child): child is Record<string, unknown> => child !== null).map(postgresNode)
    : [];
  return {
    label: join && !type.includes(join) ? `${type} (${join})` : type,
    details,
    cost: num(raw["Total Cost"]),
    rows: estimated,
    actualRows,
    timeMs: actualTime !== null ? actualTime * (loops ?? 1) : null,
    share: null,
    warnings,
    children,
  };
}

export function parsePostgresPlan(output: string): Plan | null {
  const parsed = parseJson(output);
  const top = record(Array.isArray(parsed) ? parsed[0] : parsed);
  const plan = record(top?.["Plan"]);
  if (!top || !plan) return null;
  const root = postgresNode(plan);
  const analyzed = root.timeMs !== null;
  applyShares(root, analyzed ? (node) => node.timeMs : (node) => node.cost);
  return { root, analyzed, planningMs: num(top["Planning Time"]), executionMs: num(top["Execution Time"]) };
}

// ---- MySQL and MariaDB: EXPLAIN FORMAT=JSON ----

/** Keys that hold numbers or lists of names, not steps. */
const MYSQL_SKIPPED = new Set(["cost_info", "used_columns", "possible_keys", "used_key_parts", "key_length", "ref", "partitions"]);

const humanize = (key: string) => {
  const words = key.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function mysqlTable(raw: Record<string, unknown>): PlanNode {
  const access = text(raw["access_type"]) ?? "table";
  const name = text(raw["table_name"]) ?? "?";
  const key = text(raw["key"]);
  const details = [name];
  if (key) details.push(`index ${key}`);
  const condition = text(raw["attached_condition"]) ?? text(raw["index_condition"]);
  if (condition) details.push(`condition: ${condition}`);
  const cost = record(raw["cost_info"]);
  const rows = num(raw["rows_examined_per_scan"]) ?? num(raw["rows"]);
  const warnings: PlanWarning[] = [];
  if (access === "ALL" && (rows ?? 0) >= BIG_SCAN_ROWS) warnings.push("sequentialScan");
  if (raw["using_filesort"] === true) warnings.push("filesort");
  if (raw["using_temporary_table"] === true) warnings.push("temporaryTable");
  return {
    label: access === "ALL" ? "Full table scan" : `Access: ${access}`,
    details,
    // What reading this table costs by itself (`prefix_cost` would add the tables before it).
    cost: sum([num(cost?.["read_cost"]), num(cost?.["eval_cost"])]) || null,
    rows,
    actualRows: null,
    timeMs: null,
    share: null,
    warnings,
    children: mysqlChildren(raw),
  };
}

function mysqlNodes(value: unknown, key: string): PlanNode[] {
  if (Array.isArray(value)) {
    if (key !== "nested_loop") return value.flatMap((item) => mysqlNodes(item, key));
    // The tables of a join are wrapped one by one: {"table": {...}}.
    const children = value.flatMap((item) => mysqlChildren(record(item) ?? {}));
    if (children.length <= 1) return children;
    return [{ label: "Nested loop join", details: [], cost: null, rows: null, actualRows: null, timeMs: null, share: null, warnings: [], children }];
  }
  const raw = record(value);
  if (!raw) return [];
  if (key === "table" || raw["table_name"] !== undefined) return [mysqlTable(raw)];
  const warnings: PlanWarning[] = [];
  if (raw["using_filesort"] === true) warnings.push("filesort");
  if (raw["using_temporary_table"] === true) warnings.push("temporaryTable");
  // A wrapper that only holds one step adds nothing to read.
  const children = mysqlChildren(raw);
  if (key === "nested_loop" && children.length === 1) return children;
  const cost = record(raw["cost_info"]);
  return [
    {
      label: key === "nested_loop" ? "Nested loop join" : humanize(key),
      details: [],
      cost: num(cost?.["query_cost"]) ?? num(raw["cost"]),
      rows: null,
      actualRows: null,
      timeMs: null,
      share: null,
      warnings,
      children,
    },
  ];
}

function mysqlChildren(raw: Record<string, unknown>): PlanNode[] {
  return Object.entries(raw).flatMap(([key, value]) => (MYSQL_SKIPPED.has(key) ? [] : mysqlNodes(value, key)));
}

export function parseMysqlPlan(output: string): Plan | null {
  const parsed = record(parseJson(output));
  const block = record(parsed?.["query_block"]);
  if (!block) return null;
  const [root] = mysqlNodes(block, "query_block");
  if (!root) return null;
  root.label = "Query";
  // Only the tables carry a cost of their own; what each one costs, out of all of them, is its share.
  const tables: PlanNode[] = [];
  walkPlan(root, (node) => {
    if (node.details.length > 0 && node.cost !== null) tables.push(node);
  });
  const total = sum(tables.map((node) => node.cost));
  if (total > 0) for (const node of tables) node.share = (node.cost ?? 0) / total;
  return { root, analyzed: false, planningMs: null, executionMs: null };
}

export function walkPlan(node: PlanNode, visit: (node: PlanNode) => void): void {
  visit(node);
  node.children.forEach((child) => walkPlan(child, visit));
}

// ---- SQLite: EXPLAIN QUERY PLAN ----

/** Rows are [id, parent, notused, detail]; a step whose parent is 0 is at the top. */
export function parseSqlitePlan(rows: (string | null)[][]): Plan | null {
  const steps = rows.flatMap(([id, parent, , detail]) => {
    const key = num(id);
    const up = num(parent);
    return key !== null && up !== null && detail ? [{ key, up, detail }] : [];
  });
  if (steps.length === 0) return null;
  const nodes = new Map<number, PlanNode>();
  for (const { key, detail } of steps) {
    const warnings: PlanWarning[] = [];
    // "SCAN t" reads every row; "SEARCH t USING INDEX …" does not. A covering index still reads the whole index.
    if (/^SCAN\b/.test(detail) && !/\bUSING\b/.test(detail)) warnings.push("sequentialScan");
    if (/USE TEMP B-TREE FOR (ORDER BY|RIGHT PART OF ORDER BY)/.test(detail)) warnings.push("filesort");
    else if (/TEMP B-TREE|MATERIALIZE/.test(detail)) warnings.push("temporaryTable");
    nodes.set(key, { label: detail, details: [], cost: null, rows: null, actualRows: null, timeMs: null, share: null, warnings, children: [] });
  }
  const root: PlanNode = { label: "Query", details: [], cost: null, rows: null, actualRows: null, timeMs: null, share: null, warnings: [], children: [] };
  for (const { key, up } of steps) {
    const node = nodes.get(key)!;
    (nodes.get(up) ?? root).children.push(node);
  }
  return { root, analyzed: false, planningMs: null, executionMs: null };
}
