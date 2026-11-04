import { describe, expect, it } from "vitest";
import { capRows, PG_NULL, parseCsv, parseMongoDocuments, parseMysqlBatch, parsePgCsv } from "./sql-result";

describe("parseCsv", () => {
  it("reads quoted fields with commas, quotes and line breaks", () => {
    expect(parseCsv('a,b\n"x,1","he said ""hi"""\n"two\nlines",z\n')).toEqual([
      ["a", "b"],
      ["x,1", 'he said "hi"'],
      ["two\nlines", "z"],
    ]);
  });
  it("keeps an empty last field", () => {
    expect(parseCsv("a,b\n1,\n")).toEqual([["a", "b"], ["1", ""]]);
  });
});

describe("parsePgCsv", () => {
  it("tells NULL from an empty string", () => {
    const result = parsePgCsv(`id,name\n1,${PG_NULL}\n2,""\n`);
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toEqual([["1", null], ["2", ""]]);
  });
  it("is empty when there is nothing", () => {
    expect(parsePgCsv("")).toEqual({ columns: [], rows: [], truncated: false });
  });
});

describe("parseMysqlBatch", () => {
  it("unescapes cells and reads NULL", () => {
    const result = parseMysqlBatch("id\tname\n1\tNULL\n2\ta\\tb\\nc\n");
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toEqual([["1", null], ["2", "a\tb\nc"]]);
  });
  it("has no column when a query returns nothing", () => {
    expect(parseMysqlBatch("")).toEqual({ columns: [], rows: [], truncated: false });
  });
});

describe("parseMongoDocuments", () => {
  it("builds columns from the keys and shows nested values as JSON", () => {
    const result = parseMongoDocuments('[{"_id":"1","a":{"b":2}},{"_id":"2","c":null}]');
    expect(result.columns).toEqual(["_id", "a", "c"]);
    expect(result.rows).toEqual([["1", '{"b":2}', null], ["2", null, null]]);
  });
  it("survives something that is not JSON", () => {
    expect(parseMongoDocuments("oops").rows).toEqual([]);
  });
});

describe("capRows", () => {
  it("cuts and says so", () => {
    const result = capRows({ columns: ["a"], rows: [["1"], ["2"], ["3"]], truncated: false }, 2);
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});
