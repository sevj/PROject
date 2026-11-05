import { describe, expect, it } from "vitest";
import { type Cron, decodeBase64, decodeJwt, encodeBase64, formatJson, generatePassword, nextRuns, parseCron, readTimestamp, uuidV4, uuidV7 } from "./tools";

describe("generatePassword", () => {
  it("has the length asked and one character of each class at least", () => {
    for (let round = 0; round < 50; round++) {
      const password = generatePassword({ length: 12, classes: ["lower", "upper", "digits", "symbols"], ambiguous: false });
      expect(password).toHaveLength(12);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
      expect(password).not.toMatch(/[lIO01]/);
    }
  });

  it("keeps to the classes asked", () => {
    expect(generatePassword({ length: 30, classes: ["digits"], ambiguous: true })).toMatch(/^[0-9]{30}$/);
  });
});

describe("uuidV4", () => {
  it("sets its version and variant over random bytes", () => {
    expect(uuidV4(new Uint8Array(16).fill(0xff))).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(uuidV4(new Uint8Array(16))).toBe("00000000-0000-4000-8000-000000000000");
  });
});

describe("uuidV7", () => {
  it("starts with the time, then its version and variant", () => {
    const id = uuidV7(0x0189_abcd_ef01, new Uint8Array(10).fill(0xff));
    expect(id).toBe("0189abcd-ef01-7fff-bfff-ffffffffffff");
  });
});

describe("base64", () => {
  it("goes both ways in UTF-8, url-safe or not", () => {
    expect(encodeBase64("héllo ✓")).toBe("aMOpbGxvIOKckw==");
    expect(encodeBase64("héllo ✓", true)).toBe("aMOpbGxvIOKckw");
    expect(decodeBase64("aMOpbGxvIOKckw")).toBe("héllo ✓");
    expect(decodeBase64("not base64!")).toBeNull();
    expect(decodeBase64("/w==")).toBeNull();
  });
});

describe("decodeJwt", () => {
  const part = (value: unknown) => encodeBase64(JSON.stringify(value), true);
  const token = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "1", exp: 1000, iat: 900 })}.sig`;

  it("reads header, payload and dates, without checking the signature", () => {
    expect(decodeJwt(`Bearer ${token}`, 999_000)).toEqual({
      header: { alg: "HS256", typ: "JWT" },
      payload: { sub: "1", exp: 1000, iat: 900 },
      times: [
        { name: "exp", at: 1_000_000 },
        { name: "iat", at: 900_000 },
      ],
      expired: false,
    });
    expect(decodeJwt(token, 1_000_000)?.expired).toBe(true);
    expect(decodeJwt("a.b", 0)).toBeNull();
    expect(decodeJwt("abc.def.ghi", 0)).toBeNull();
  });
});

describe("formatJson", () => {
  it("indents or writes on one line, and says where it breaks", () => {
    expect(formatJson('{"a":[1,2]}', 2)).toEqual({ output: '{\n  "a": [\n    1,\n    2\n  ]\n}' });
    expect(formatJson('{ "a": 1 }', 0)).toEqual({ output: '{"a":1}' });
    expect(formatJson('{\n  "a": 1,\n}', 2)).toMatchObject({ line: 3, column: 1 });
  });
});

describe("readTimestamp", () => {
  it("tells seconds from ms, and reads dates", () => {
    expect(readTimestamp("1700000000")).toBe(1_700_000_000_000);
    expect(readTimestamp("1700000000123")).toBe(1_700_000_000_123);
    expect(readTimestamp("2023-11-14T22:13:20Z")).toBe(1_700_000_000_000);
    expect(readTimestamp("tomorrow")).toBeNull();
    expect(readTimestamp(" ")).toBeNull();
  });
});

describe("cron", () => {
  const cron = (expression: string) => parseCron(expression) as Cron;

  it("reads the five fields, names and macros", () => {
    expect(cron("*/15 3 * * MON-FRI").fields).toEqual({
      minute: { kind: "every", step: 15 },
      hour: { kind: "list", values: [3] },
      dayOfMonth: { kind: "all" },
      month: { kind: "all" },
      dayOfWeek: { kind: "list", values: [1, 2, 3, 4, 5] },
    });
    expect(cron("0 0 * * 7").fields.dayOfWeek).toEqual({ kind: "list", values: [0] });
    expect(cron("@daily").fields.hour).toEqual({ kind: "list", values: [0] });
    expect(cron("5/20 * * * *").fields.minute).toEqual({ kind: "list", values: [5, 25, 45] });
  });

  it("says which field is wrong", () => {
    expect(parseCron("* * *")).toEqual({ field: null, text: "* * *" });
    expect(parseCron("60 * * * *")).toEqual({ field: "minute", text: "60" });
    expect(parseCron("* * * FOO *")).toEqual({ field: "month", text: "FOO" });
    expect(parseCron("*/0 * * * *")).toEqual({ field: "minute", text: "*/0" });
  });

  it("gives the next runs, either day being enough when both are set", () => {
    const from = new Date(2026, 10, 5, 10, 7).getTime(); // a Thursday
    expect(nextRuns(cron("*/15 * * * *"), from, 3)).toEqual([new Date(2026, 10, 5, 10, 15).getTime(), new Date(2026, 10, 5, 10, 30).getTime(), new Date(2026, 10, 5, 10, 45).getTime()]);
    expect(nextRuns(cron("0 9 * * MON"), from, 1)).toEqual([new Date(2026, 10, 9, 9, 0).getTime()]);
    expect(nextRuns(cron("0 0 13 * FRI"), from, 2)).toEqual([new Date(2026, 10, 6).getTime(), new Date(2026, 10, 13).getTime()]);
    expect(nextRuns(cron("0 0 29 2 *"), from, 1)).toEqual([new Date(2028, 1, 29).getTime()]);
    expect(nextRuns(cron("0 0 31 2 *"), from, 1)).toEqual([]);
  });
});
