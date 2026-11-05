import { describe, expect, it } from "vitest";
import {
  type ForeignKey,
  followFilter,
  groupForeignKeys,
  layoutRelations,
  linksOf,
  parseRowFilter,
  relationsOf,
  tableId,
  tableLabel,
  touching,
} from "./db-schema";

const key = (from: string, column: string, to: string, name = `${from}_${column}`): ForeignKey => ({
  name,
  from: { schema: null, name: from },
  columns: [column],
  to: { schema: null, name: to },
  refColumns: ["id"],
});

describe("groupForeignKeys", () => {
  it("puts the columns of a composite key together, in order", () => {
    const keys = groupForeignKeys([
      ["fk_a", "public", "lines", "order_id", "public", "orders", "id"],
      ["fk_b", "public", "lines", "shop", "public", "stock", "shop_id"],
      ["fk_b", "public", "lines", "sku", "public", "stock", "sku_id"],
    ]);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toEqual({
      name: "fk_b",
      from: { schema: "public", name: "lines" },
      columns: ["shop", "sku"],
      to: { schema: "public", name: "stock" },
      refColumns: ["shop_id", "sku_id"],
    });
  });

  it("does not mix two constraints of the same name on different tables", () => {
    const keys = groupForeignKeys([
      ["fk", null, "a", "x", null, "c", "id"],
      ["fk", null, "b", "x", null, "c", "id"],
    ]);
    expect(keys.map(({ from }) => from.name)).toEqual(["a", "b"]);
  });

  it("skips a row with a part missing", () => {
    expect(groupForeignKeys([["fk", null, "a", "x", null, "c", null]])).toEqual([]);
  });
});

describe("links and relations", () => {
  const keys = [key("orders", "user_id", "users"), key("users", "team_id", "teams")];

  it("finds the key of each column of a table", () => {
    const links = linksOf(keys, { schema: null, name: "orders" });
    expect([...links.keys()]).toEqual(["user_id"]);
    expect(links.get("user_id")?.to.name).toBe("users");
  });

  it("tells a schema's table from the same name in another", () => {
    expect(linksOf(keys, { schema: "other", name: "orders" }).size).toBe(0);
  });

  it("separates what a table points to from what points to it", () => {
    const { outgoing, incoming } = relationsOf(keys, { schema: null, name: "users" });
    expect(outgoing.map(({ to }) => to.name)).toEqual(["teams"]);
    expect(incoming.map(({ from }) => from.name)).toEqual(["orders"]);
    expect(touching(keys, { schema: null, name: "teams" }).map(({ from }) => from.name)).toEqual(["users"]);
  });

  it("names a table without the usual schema", () => {
    expect(tableLabel({ schema: "public", name: "a" })).toBe("a");
    expect(tableLabel({ schema: "sales", name: "a" })).toBe("sales.a");
    expect(tableLabel({ schema: null, name: "a" })).toBe("a");
  });
});

describe("followFilter", () => {
  const composite: ForeignKey = { ...key("lines", "shop", "stock"), columns: ["shop", "sku"], refColumns: ["shop_id", "sku_id"] };

  it("gives the columns of the designated row, with this row's values", () => {
    expect(followFilter(composite, ["id", "sku", "shop"], ["1", "S", "7"])).toEqual([
      { column: "shop_id", value: "7" },
      { column: "sku_id", value: "S" },
    ]);
  });

  it("designates nothing with a NULL or a column that is not shown", () => {
    expect(followFilter(composite, ["shop", "sku"], ["7", null])).toBeNull();
    expect(followFilter(composite, ["shop"], ["7"])).toBeNull();
  });
});

describe("parseRowFilter", () => {
  it("accepts column and value pairs of text", () => {
    expect(parseRowFilter([{ column: "id", value: "1" }])).toEqual([{ column: "id", value: "1" }]);
  });

  it("refuses anything else", () => {
    for (const input of [null, "id", [], [null], [{ column: "id" }], [{ column: "id", value: 1 }]]) {
      expect(parseRowFilter(input)).toBeNull();
    }
    expect(parseRowFilter(Array.from({ length: 33 }, () => ({ column: "a", value: "b" })))).toBeNull();
  });
});

describe("layoutRelations", () => {
  const nodeOf = (keys: ForeignKey[], name: string) =>
    layoutRelations(keys).nodes.find(({ table }) => table.name === name);

  it("puts a table to the left of those it points to, whatever the longest path", () => {
    const keys = [key("a", "b_id", "b"), key("b", "c_id", "c"), key("a", "c_id", "c")];
    expect(nodeOf(keys, "a")?.x).toBeLessThan(nodeOf(keys, "b")?.x ?? 0);
    expect(nodeOf(keys, "b")?.x).toBeLessThan(nodeOf(keys, "c")?.x ?? 0);
  });

  it("stacks the tables of a column without overlap", () => {
    const { nodes } = layoutRelations([key("a", "x", "z"), key("b", "x", "z")]);
    const [first, second] = nodes.filter(({ table }) => table.name !== "z");
    expect(first.x).toBe(second.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it("stays wider than tall with many tables, without overlap", () => {
    const keys = Array.from({ length: 80 }, (_, index) => key(`t${String(index).padStart(2, "0")}`, "x_id", "x"));
    const { nodes } = layoutRelations(keys);
    expect(nodes).toHaveLength(81);
    const width = Math.max(...nodes.map(({ x }) => x)) + 320;
    const height = Math.max(...nodes.map(({ y }) => y)) + 100;
    expect(width).toBeGreaterThan(height);
    expect(new Set(nodes.map(({ x, y }) => `${x}/${y}`)).size).toBe(81);
    const target = nodes.find(({ table }) => table.name === "x");
    expect(target?.x).toBeGreaterThan(Math.max(...nodes.filter((node) => node !== target).map(({ x }) => x)));
  });

  it("puts a table near those that point to it", () => {
    const keys = [key("a", "x", "z_for_a"), key("b", "x", "y_for_b")];
    const names = layoutRelations(keys).nodes.filter(({ x }) => x > 0).map(({ table }) => table.name);
    expect(names).toEqual(["z_for_a", "y_for_b"]);
  });

  it("survives a cycle and places every table", () => {
    const { nodes, edges } = layoutRelations([key("a", "b_id", "b"), key("b", "a_id", "a")]);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(2);
  });

  it("says a key to the table itself in its node, without an edge", () => {
    const { nodes, edges } = layoutRelations([key("tree", "parent_id", "tree")]);
    expect(edges).toEqual([]);
    expect(nodes[0].columns).toEqual([
      { name: "id", role: "target" },
      { name: "parent_id", role: "self" },
    ]);
  });

  it("keeps two keys between the same tables apart", () => {
    const { edges } = layoutRelations([key("a", "x", "b"), key("a", "y", "b")]);
    expect(new Set(edges.map(({ id }) => id)).size).toBe(2);
    expect(edges[0].source).toBe(tableId({ schema: null, name: "a" }));
  });
});
