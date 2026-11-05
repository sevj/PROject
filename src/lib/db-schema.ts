export type TableKey = { schema: string | null; name: string };

/** One constraint: several columns when the key is composite, in the order of the key. */
export type ForeignKey = {
  name: string;
  from: TableKey;
  columns: string[];
  to: TableKey;
  refColumns: string[];
};

/** `column = value` for each entry, all of them together: values are text, as the rows show them. */
export type RowFilter = { column: string; value: string }[];

/** name, schema, table, column, referenced schema, referenced table, referenced column: one row per column of a key. */
export type ForeignKeyRow = (string | null)[];

const sameTable = (a: TableKey, b: TableKey) => a.name === b.name && (a.schema ?? null) === (b.schema ?? null);

export const tableId = ({ schema, name }: TableKey) => JSON.stringify([schema ?? null, name]);

/** The usual schema goes without saying. */
export const tableLabel = ({ schema, name }: TableKey) => (schema && schema !== "public" ? `${schema}.${name}` : name);

export function groupForeignKeys(rows: ForeignKeyRow[]): ForeignKey[] {
  const keys = new Map<string, ForeignKey>();
  for (const [name, schema, table, column, refSchema, refTable, refColumn] of rows) {
    if (!name || !table || !column || !refTable || !refColumn) continue;
    const id = JSON.stringify([schema, table, name]);
    const key = keys.get(id) ?? {
      name,
      from: { schema: schema ?? null, name: table },
      columns: [],
      to: { schema: refSchema ?? null, name: refTable },
      refColumns: [],
    };
    key.columns.push(column);
    key.refColumns.push(refColumn);
    keys.set(id, key);
  }
  return [...keys.values()];
}

/** The key a column of this table belongs to, the first one if there are several. */
export function linksOf(foreignKeys: ForeignKey[], table: TableKey): Map<string, ForeignKey> {
  const links = new Map<string, ForeignKey>();
  for (const key of foreignKeys) {
    if (!sameTable(key.from, table)) continue;
    for (const column of key.columns) if (!links.has(column)) links.set(column, key);
  }
  return links;
}

export function relationsOf(foreignKeys: ForeignKey[], table: TableKey) {
  return {
    outgoing: foreignKeys.filter(({ from }) => sameTable(from, table)),
    incoming: foreignKeys.filter(({ to }) => sameTable(to, table)),
  };
}

/** The keys that leave or reach this table: the rest is not its neighborhood. */
export const touching = (foreignKeys: ForeignKey[], table: TableKey) =>
  foreignKeys.filter(({ from, to }) => sameTable(from, table) || sameTable(to, table));

/**
 * What finds the row a key designates in this row. As in the database, a key with
 * a NULL in it designates nothing.
 */
export function followFilter(key: ForeignKey, resultColumns: string[], row: (string | null)[]): RowFilter | null {
  const filter: RowFilter = [];
  for (const [index, column] of key.columns.entries()) {
    const at = resultColumns.indexOf(column);
    const value = at === -1 ? null : row[at];
    if (value === null || value === undefined) return null;
    filter.push({ column: key.refColumns[index], value });
  }
  return filter;
}

const MAX_FILTER_COLUMNS = 32;

/** It comes from the browser: only its shape is checked here, the values are quoted when they are used. */
export function parseRowFilter(input: unknown): RowFilter | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_FILTER_COLUMNS) return null;
  const filter: RowFilter = [];
  for (const entry of input) {
    const { column, value } = (entry ?? {}) as { column?: unknown; value?: unknown };
    if (typeof column !== "string" || typeof value !== "string") return null;
    filter.push({ column, value });
  }
  return filter;
}

export type RelationColumn = {
  name: string;
  /** A key to another table, to the table itself, or what a key designates. */
  role: "key" | "self" | "target";
};
export type RelationNode = { id: string; table: TableKey; columns: RelationColumn[]; x: number; y: number };
export type RelationEdge = { id: string; source: string; target: string; label: string };
export type RelationLayout = { nodes: RelationNode[]; edges: RelationEdge[] };

const COLUMN_WIDTH = 320;
const HEADER_HEIGHT = 44;
const LINE_HEIGHT = 20;
const GAP = 28;
const MIN_COLUMN_HEIGHT = 480;
const WIDTH_PER_HEIGHT = 1.5;

/**
 * Columns from left to right: a table stands to the left of those it points to, and a column
 * that gets too tall goes on beside itself. A table in a cycle keeps the place it was first
 * given, and a key to itself is said in its node, not drawn.
 */
export function layoutRelations(foreignKeys: ForeignKey[]): RelationLayout {
  const tables = new Map<string, TableKey>();
  const columns = new Map<string, Map<string, RelationColumn["role"]>>();
  const targets = new Map<string, Set<string>>();
  const pointedAt = new Set<string>();

  const touch = (table: TableKey) => {
    const id = tableId(table);
    tables.set(id, table);
    if (!columns.has(id)) columns.set(id, new Map());
    if (!targets.has(id)) targets.set(id, new Set());
    return id;
  };

  for (const key of foreignKeys) {
    const source = touch(key.from);
    const target = touch(key.to);
    const self = source === target;
    for (const name of key.refColumns) if (!columns.get(target)?.has(name)) columns.get(target)?.set(name, "target");
    // Being a key says more about a column than being designated by one.
    for (const name of key.columns) columns.get(source)?.set(name, self ? "self" : "key");
    if (!self) {
      targets.get(source)?.add(target);
      pointedAt.add(target);
    }
  }

  const ranks = new Map<string, number>();
  const onPath = new Set<string>();
  const place = (id: string, rank: number) => {
    if (onPath.has(id) || (ranks.get(id) ?? -1) >= rank) return;
    ranks.set(id, rank);
    onPath.add(id);
    for (const target of targets.get(id) ?? []) place(target, rank + 1);
    onPath.delete(id);
  };
  const ids = [...tables.keys()].sort((a, b) => a.localeCompare(b));
  for (const id of ids) if (!pointedAt.has(id)) place(id, 0);
  // Only cycles are left: nothing points at them from outside.
  for (const id of ids) if (!ranks.has(id)) place(id, 0);

  const listOf = (id: string) => [...(columns.get(id)?.entries() ?? [])].map(([name, role]) => ({ name, role }));
  const heightOf = (id: string) => HEADER_HEIGHT + (columns.get(id)?.size ?? 0) * LINE_HEIGHT + GAP;
  const nameOf = (id: string) => tables.get(id)?.name ?? "";

  // Wider than tall, like the screen: a long column would be shrunk until nothing can be read.
  const area = ids.reduce((sum, id) => sum + heightOf(id), 0) * COLUMN_WIDTH;
  const maxHeight = Math.max(MIN_COLUMN_HEIGHT, Math.sqrt(area / WIDTH_PER_HEIGHT));

  const byRank = new Map<number, string[]>();
  for (const id of ids) {
    const rank = ranks.get(id) ?? 0;
    byRank.set(rank, [...(byRank.get(rank) ?? []), id]);
  }

  // Each table goes near the tables that point to it, which are placed already.
  const sources = new Map<string, string[]>();
  for (const [source, list] of targets) for (const target of list) sources.set(target, [...(sources.get(target) ?? []), source]);
  const order = new Map<string, number>();
  const nearness = (id: string) => {
    const known = (sources.get(id) ?? []).flatMap((source) => order.get(source) ?? []);
    return known.length === 0 ? Number.POSITIVE_INFINITY : known.reduce((sum, value) => sum + value, 0) / known.length;
  };

  const nodes: RelationNode[] = [];
  let x = 0;
  for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
    const inRank = (byRank.get(rank) ?? [])
      .map((id) => ({ id, near: nearness(id) }))
      .sort((a, b) => (a.near === b.near ? nameOf(a.id).localeCompare(nameOf(b.id)) : a.near - b.near));
    let y = 0;
    inRank.forEach(({ id }, index) => {
      if (y > 0 && y + heightOf(id) > maxHeight) {
        x += COLUMN_WIDTH;
        y = 0;
      }
      order.set(id, index);
      nodes.push({ id, table: tables.get(id) as TableKey, columns: listOf(id), x, y });
      y += heightOf(id);
    });
    x += COLUMN_WIDTH;
  }

  const edges = foreignKeys.flatMap((key): RelationEdge[] => {
    const source = tableId(key.from);
    const target = tableId(key.to);
    return source === target
      ? []
      : [{ id: JSON.stringify([source, key.name]), source, target, label: key.columns.join(", ") }];
  });
  return { nodes, edges };
}
