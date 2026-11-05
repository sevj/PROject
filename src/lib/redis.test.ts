import { describe, expect, it } from "vitest";
import { checkDbIndex, checkScanPattern, parseInfo, parseKeyPage, parseValue } from "./redis";

describe("parseKeyPage", () => {
  it("reads keys, types and expiry, and a key without expiry has none", () => {
    expect(parseKeyPage('{"cursor":"17","keys":[["user:1","hash",-1],["cache:a","string",5000]]}')).toEqual({
      cursor: "17",
      keys: [
        { key: "user:1", type: "hash", ttlMs: null },
        { key: "cache:a", type: "string", ttlMs: 5000 },
      ],
    });
  });

  it("reads Lua's empty table as an empty list", () => {
    expect(parseKeyPage('{"cursor":"0","keys":{}}')).toEqual({ cursor: "0", keys: [] });
  });

  it("refuses what is not JSON, and a cursor that is not a number", () => {
    expect(parseKeyPage("ERR nope")).toBeNull();
    expect(parseKeyPage('{"cursor":"x; FLUSHALL","keys":{}}')?.cursor).toBe("0");
  });
});

describe("parseValue", () => {
  it("reads a hash as field/value pairs and a zset as member/score", () => {
    expect(parseValue('{"type":"hash","ttl":-1,"size":2,"items":["a","1","b","2"]}')?.entries).toEqual([
      { label: "a", value: "1" },
      { label: "b", value: "2" },
    ]);
    expect(parseValue('{"type":"zset","ttl":-1,"size":1,"items":["alice","42"]}')?.entries).toEqual([{ label: "42", value: "alice" }]);
  });

  it("reads a stream and a list", () => {
    expect(parseValue('{"type":"stream","ttl":-1,"size":1,"items":[["1-0",["k","v","x","y"]]]}')?.entries).toEqual([{ label: "1-0", value: "k=v  x=y" }]);
    expect(parseValue('{"type":"list","ttl":10,"size":2,"items":["a","b"]}')).toMatchObject({ ttlMs: 10, truncated: false });
  });

  it("says when only part is shown", () => {
    const items = Array.from({ length: 150 }, (_, i) => `"${i}"`).join(",");
    const value = parseValue(`{"type":"set","ttl":-1,"size":150,"items":[${items}]}`);
    expect(value?.entries).toHaveLength(100);
    expect(value?.truncated).toBe(true);
  });

  it("keeps a string as text", () => {
    expect(parseValue('{"type":"string","ttl":-1,"size":3,"value":"abc"}')).toMatchObject({ text: "abc", entries: [], truncated: false });
  });
});

describe("parseInfo", () => {
  it("reads fields and the databases that hold keys", () => {
    const info = parseInfo("# Server\r\nredis_version:7.2.4\r\n\r\n# Keyspace\r\ndb0:keys=12,expires=1,avg_ttl=0\r\ndb3:keys=2,expires=0,avg_ttl=0\r\n");
    expect(info.fields.redis_version).toBe("7.2.4");
    expect(info.databases).toEqual([{ index: 0, keys: 12 }, { index: 3, keys: 2 }]);
  });
});

describe("input checks", () => {
  it("defaults the pattern and refuses a NUL or a very long one", () => {
    expect(checkScanPattern("  ")).toBe("*");
    expect(checkScanPattern("user:*")).toBe("user:*");
    expect(checkScanPattern("a\0b")).toBeNull();
    expect(checkScanPattern("x".repeat(201))).toBeNull();
  });

  it("accepts a database index from 0 to 255", () => {
    expect(checkDbIndex("0")).toBe(0);
    expect(checkDbIndex("15")).toBe(15);
    expect(checkDbIndex("256")).toBeNull();
    expect(checkDbIndex("1; FLUSHALL")).toBeNull();
  });
});
