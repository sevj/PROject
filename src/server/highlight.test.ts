import { describe, expect, it } from "vitest";
import { highlightSource, languageOf } from "./highlight";

describe("languageOf", () => {
  it("reads the language from the name", () => {
    expect(languageOf("src/a.tsx")).toBe("tsx");
    expect(languageOf("phpunit.xml.dist")).toBe("xml");
    expect(languageOf("docker/Dockerfile.prod")).toBe("dockerfile");
    expect(languageOf("Makefile")).toBe("make");
    expect(languageOf("LICENSE")).toBeNull();
  });
});

describe("highlightSource", () => {
  it("gives one line of tokens per line, with both themes' colors", async () => {
    const lines = await highlightSource("a.php", "<?php\n$a = 1;\n");
    expect(lines).toHaveLength(2);
    expect(lines![1].map(([text]) => text).join("")).toBe("$a = 1;");
    const [, light, dark] = lines![1][0];
    expect(light).toMatch(/^#/);
    expect(dark).toMatch(/^#/);
    expect(light).not.toBe(dark);
  });

  it("leaves unknown files plain", async () => {
    expect(await highlightSource("notes", "text")).toBeNull();
  });
});
