import { describe, expect, it } from "vitest";
import { compareEnv, envValues, parseEnv, writeEnvValue } from "./env-file";

const values = (content: string) => Object.fromEntries(envValues(parseEnv(content)));

describe("parseEnv", () => {
  it("reads a value over several lines without taking its lines for variables", () => {
    expect(parseEnv('KEY="one\nFAKE=two"\nNEXT=3\n')).toEqual([
      { key: "KEY", value: "one\nFAKE=two" },
      { key: "NEXT", value: "3" },
    ]);
  });

  it("decodes double quotes and leaves single quotes as they are", () => {
    expect(parseEnv(String.raw`A="a\"b\\c\nd\$e"` + "\n" + String.raw`B='a\nb'`)).toEqual([
      { key: "A", value: 'a"b\\c\nd$e' },
      { key: "B", value: String.raw`a\nb` },
    ]);
  });

  it("does not let a quote that never closes swallow the file", () => {
    expect(parseEnv('A="open\nB=2\n')).toEqual([
      { key: "A", value: '"open' },
      { key: "B", value: "2" },
    ]);
  });

  it("tells a comment from a value starting with a hash", () => {
    expect(parseEnv("A= # note\nB=#fff\nC=1 # note\n")).toEqual([
      { key: "A", value: "" },
      { key: "B", value: "#fff" },
      { key: "C", value: "1" },
    ]);
  });
});

describe("writeEnvValue", () => {
  const file = ["# database", "export DB=old # the main one", "", "OTHER='keep'", "# end", ""].join("\n");

  it("changes only the value, keeping comments, export and order", () => {
    expect(writeEnvValue(file, "DB", "new")).toBe(
      ["# database", "export DB=new # the main one", "", "OTHER='keep'", "# end", ""].join("\n"),
    );
  });

  it("appends what the file does not have, on its own line", () => {
    expect(writeEnvValue("A=1", "B", "2")).toBe("A=1\nB=2\n");
    expect(writeEnvValue("A=1\n", "B", "2")).toBe("A=1\nB=2\n");
    expect(writeEnvValue("", "B", "2")).toBe("B=2\n");
  });

  it("keeps the line breaks of the file", () => {
    expect(writeEnvValue("A=1\r\nB=2\r\n", "A", "9")).toBe("A=9\r\nB=2\r\n");
    expect(writeEnvValue("A=1\r\n", "B", "2")).toBe("A=1\r\nB=2\r\n");
  });

  it("removes a variable and its lines only", () => {
    expect(writeEnvValue(file, "DB", null)).toBe(["# database", "", "OTHER='keep'", "# end", ""].join("\n"));
    expect(writeEnvValue('A="x\ny"\nB=2\n', "A", null)).toBe("B=2\n");
  });

  it("rewrites a value over several lines entirely", () => {
    expect(writeEnvValue('A="x\ny"\nB=2\n', "A", "z")).toBe('A="z"\nB=2\n');
  });

  it("sets the one the readers keep when a name is there twice", () => {
    const next = writeEnvValue("A=1\nA=2\n", "A", "3");
    expect(next).toBe("A=1\nA=3\n");
    expect(writeEnvValue("A=1\nB=2\nA=3\n", "A", null)).toBe("B=2\n");
  });

  it("keeps the quotes in use when they can hold the value", () => {
    expect(writeEnvValue("A='x'\n", "A", "a$b")).toBe("A='a$b'\n");
    expect(writeEnvValue('A="x"\n', "A", "y")).toBe('A="y"\n');
    expect(writeEnvValue("A='x'\n", "A", "it's")).toBe('A="it\'s"\n');
  });

  it.each([
    ["spaces", "with some spaces"],
    ["a hash", "a #b"],
    ["quotes", `"it's"`],
    ["a backslash", "c:\\new\\table"],
    ["a dollar", "pa$$word$(whoami)"],
    ["several lines", "-----BEGIN-----\nabc\n-----END-----\n"],
    ["a line break", "one\r\ntwo"],
    ["an assignment on a new line", "x\nEVIL=1"],
    ["nothing", ""],
    ["a reference", "${USER}/data"],
  ])("reads back a value with %s, and no other variable", (_, value) => {
    for (const content of ["", "A=old # note\nB=2\n", "A='old'\nB=2\n", 'A="old"\nB=2\n']) {
      const next = writeEnvValue(content, "A", value);
      expect(next).not.toBeNull();
      expect(values(next as string)).toEqual({ ...values(content), A: value });
    }
  });

  it("stays on one line whatever the value", () => {
    expect(writeEnvValue("", "A", "x\nEVIL=1")).toBe('A="x\\nEVIL=1"\n');
  });

  it("writes a dollar as a literal, except for a reference", () => {
    expect(writeEnvValue("", "A", "$(whoami)")).toBe('A="\\$(whoami)"\n');
    expect(writeEnvValue("", "A", "$HOME")).toBe('A="\\$HOME"\n');
    expect(writeEnvValue("", "A", "${HOME}/x")).toBe('A="${HOME}/x"\n');
    expect(writeEnvValue("", "A", "${unclosed")).toBe('A="\\${unclosed"\n');
  });
});

describe("compareEnv", () => {
  it("tells what is missing from the local file, in the order of the declarations", () => {
    expect(
      compareEnv(
        [
          { key: "B", value: "1" },
          { key: "A", value: "2" },
          { key: "C", value: "3" },
        ],
        [
          { key: "EXTRA", value: "x" },
          { key: "C", value: "3" },
          { key: "B", value: "other" },
        ],
        ["GONE", "B"],
      ),
    ).toEqual([
      { key: "B", declared: "1", local: "other", state: "different" },
      { key: "A", declared: "2", local: null, state: "missing" },
      { key: "C", declared: "3", local: "3", state: "same" },
      { key: "EXTRA", declared: null, local: "x", state: "extra" },
      { key: "GONE", declared: null, local: null, state: "removed" },
    ]);
  });

  it("does not take an empty value for a missing one", () => {
    expect(compareEnv([{ key: "A", value: "1" }], [{ key: "A", value: "" }])[0].state).toBe("different");
  });
});
