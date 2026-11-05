import { describe, expect, it } from "vitest";
import { parseMysqlPlan, parsePostgresPlan, parseSqlitePlan, walkPlan } from "./explain";

const postgres = (plan: object, extra: object = {}) => JSON.stringify([{ Plan: plan, ...extra }]);

describe("parsePostgresPlan", () => {
  it("reads a plan without ANALYZE and shares cost by step", () => {
    const plan = parsePostgresPlan(
      postgres({
        "Node Type": "Sort",
        "Total Cost": 100,
        "Plan Rows": 5,
        "Sort Key": ["name"],
        Plans: [{ "Node Type": "Seq Scan", "Relation Name": "users", Alias: "u", "Total Cost": 80, "Plan Rows": 50000, Filter: "(a = 1)" }],
      }),
    );
    expect(plan?.analyzed).toBe(false);
    expect(plan?.root.label).toBe("Sort");
    expect(plan?.root.share).toBeCloseTo(0.2);
    const scan = plan!.root.children[0];
    expect(scan.share).toBeCloseTo(0.8);
    expect(scan.details).toEqual(["users (u)", "filter: (a = 1)"]);
    expect(scan.warnings).toEqual(["sequentialScan"]);
  });

  it("uses measured time with ANALYZE, times loops, and flags a wrong estimate", () => {
    const plan = parsePostgresPlan(
      postgres(
        {
          "Node Type": "Nested Loop",
          "Join Type": "Inner",
          "Total Cost": 10,
          "Plan Rows": 1,
          "Actual Rows": 500,
          "Actual Loops": 1,
          "Actual Total Time": 100,
          Plans: [{ "Node Type": "Index Scan", "Index Name": "i", "Relation Name": "t", "Total Cost": 1, "Plan Rows": 1, "Actual Rows": 1, "Actual Loops": 400, "Actual Total Time": 0.2 }],
        },
        { "Planning Time": 0.4, "Execution Time": 101 },
      ),
    );
    expect(plan?.analyzed).toBe(true);
    expect(plan?.executionMs).toBe(101);
    expect(plan?.root.label).toBe("Nested Loop (Inner)");
    expect(plan?.root.warnings).toContain("badEstimate");
    expect(plan?.root.children[0].timeMs).toBeCloseTo(80);
    expect(plan?.root.share).toBeCloseTo(0.2);
  });

  it("returns null for anything else", () => {
    expect(parsePostgresPlan("nope")).toBeNull();
    expect(parsePostgresPlan("[]")).toBeNull();
  });
});

describe("parseMysqlPlan", () => {
  it("builds a tree from nested_loop and flags a full scan and a filesort", () => {
    const plan = parseMysqlPlan(
      JSON.stringify({
        query_block: {
          select_id: 1,
          cost_info: { query_cost: "20.5" },
          ordering_operation: {
            using_filesort: true,
            nested_loop: [
              { table: { table_name: "a", access_type: "ALL", rows_examined_per_scan: 50000, cost_info: { read_cost: "30", eval_cost: "10" } } },
              { table: { table_name: "b", access_type: "ref", key: "idx", rows_examined_per_scan: 1, cost_info: { read_cost: "9", eval_cost: "1" }, attached_condition: "(b.x = 1)" } },
            ],
          },
        },
      }),
    );
    expect(plan?.root.label).toBe("Query");
    expect(plan?.root.cost).toBe(20.5);
    const nodes: string[] = [];
    walkPlan(plan!.root, (node) => nodes.push(node.label));
    expect(nodes).toEqual(["Query", "Ordering operation", "Nested loop join", "Full table scan", "Access: ref"]);
    const ordering = plan!.root.children[0];
    expect(ordering.warnings).toEqual(["filesort"]);
    const [a, b] = ordering.children[0].children;
    expect(a.warnings).toEqual(["sequentialScan"]);
    expect(a.share).toBeCloseTo(0.8);
    expect(b.details).toEqual(["b", "index idx", "condition: (b.x = 1)"]);
  });

  it("reads a MariaDB plan, which has no cost", () => {
    const plan = parseMysqlPlan(JSON.stringify({ query_block: { select_id: 1, table: { table_name: "t", access_type: "ALL", rows: 3 } } }));
    expect(plan?.root.children[0].rows).toBe(3);
    expect(plan?.root.children[0].share).toBeNull();
  });

  it("returns null without a query block", () => {
    expect(parseMysqlPlan("{}")).toBeNull();
  });
});

describe("parseSqlitePlan", () => {
  it("nests steps by parent and flags a plain scan and a sort", () => {
    const plan = parseSqlitePlan([
      ["2", "0", "0", "SCAN users"],
      ["5", "0", "0", "SEARCH orders USING INDEX idx_user (user_id=?)"],
      ["9", "5", "0", "USE TEMP B-TREE FOR ORDER BY"],
    ]);
    const [scan, search] = plan!.root.children;
    expect(scan.warnings).toEqual(["sequentialScan"]);
    expect(search.warnings).toEqual([]);
    expect(search.children[0].warnings).toEqual(["filesort"]);
  });

  it("returns null without rows", () => {
    expect(parseSqlitePlan([])).toBeNull();
  });
});
