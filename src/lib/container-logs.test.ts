import { describe, expect, it } from "vitest";
import { cleanLogText, createLineSplitter, formatLogTime, mergeLogRows, parseLogLine } from "./container-logs";

describe("createLineSplitter", () => {
  it("gives whole lines whatever the pieces", () => {
    const splitter = createLineSplitter();
    expect(splitter.push("one\ntw")).toEqual(["one"]);
    expect(splitter.push("o\n\nthr")).toEqual(["two", ""]);
    expect(splitter.flush()).toEqual(["thr"]);
    expect(splitter.flush()).toEqual([]);
  });

  it("does not wait forever for the end of a line", () => {
    const splitter = createLineSplitter(4);
    expect(splitter.push("abc")).toEqual([]);
    expect(splitter.push("defg")).toEqual(["abcdefg"]);
    expect(splitter.flush()).toEqual([]);
  });
});

describe("cleanLogText", () => {
  it("removes colors, titles and control characters, not tabs", () => {
    expect(cleanLogText("\u001b[1;31merror\u001b[0m\tdone\r")).toBe("error\tdone");
    expect(cleanLogText("\u001b]0;title\u0007text\u0000")).toBe("text");
  });
});

describe("parseLogLine", () => {
  it("separates Docker's date from the text", () => {
    expect(parseLogLine("2026-11-05T08:27:17.370575303Z ready to accept")).toEqual({
      time: "2026-11-05T08:27:17.370575303Z",
      text: "ready to accept",
    });
  });

  it("keeps an empty line, and a date the program wrote itself", () => {
    expect(parseLogLine("2026-11-05T08:27:17Z ")).toEqual({ time: "2026-11-05T08:27:17Z", text: "" });
    expect(parseLogLine("2026-11-05T08:27:17Z 2026-11-05 LOG").text).toBe("2026-11-05 LOG");
  });

  it("leaves a line without a date alone", () => {
    expect(parseLogLine("Error response from daemon")).toEqual({ time: null, text: "Error response from daemon" });
  });
});

describe("mergeLogRows", () => {
  const row = (at: string, text = at) => ({ at, text });

  it("puts a late batch of the other stream back in its place", () => {
    const out = [row("2026-11-05T08:00:01.000000000Z"), row("2026-11-05T08:00:03.000000000Z")];
    const err = [row("2026-11-05T08:00:02.000000000Z")];
    expect(mergeLogRows(out, err, 10).map(({ at }) => at)).toEqual([
      "2026-11-05T08:00:01.000000000Z",
      "2026-11-05T08:00:02.000000000Z",
      "2026-11-05T08:00:03.000000000Z",
    ]);
  });

  it("keeps the arrival order of lines with the same date", () => {
    const merged = mergeLogRows([row("b", "first")], [row("b", "second"), row("a", "older"), row("b", "third")], 10);
    expect(merged.map(({ text }) => text)).toEqual(["older", "first", "second", "third"]);
  });

  it("keeps the most recent lines, once in order", () => {
    expect(mergeLogRows([row("c")], [row("a"), row("b")], 2).map(({ at }) => at)).toEqual(["b", "c"]);
  });
});

describe("formatLogTime", () => {
  it("shows the local month, day and time", () => {
    const time = new Date(2026, 10, 5, 8, 7, 9).toISOString();
    expect(formatLogTime(time)).toBe("11-05 08:07:09");
  });

  it("gives back what is not a date", () => {
    expect(formatLogTime("soon")).toBe("soon");
  });
});
