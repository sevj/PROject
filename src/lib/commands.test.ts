import { describe, expect, it } from "vitest";
import { buildCommand, DEFAULT_IDE_COMMANDS, ideCommandFor, ideLabel } from "./commands";

describe("ideCommandFor", () => {
  it("uses the first stack with a command, then the default", () => {
    expect(ideCommandFor(["PHP", "Node"], DEFAULT_IDE_COMMANDS)).toBe("phpstorm {path}");
    expect(ideCommandFor(["Node", "PHP"], DEFAULT_IDE_COMMANDS)).toBe("phpstorm {path}");
    expect(ideCommandFor(["Rust"], DEFAULT_IDE_COMMANDS)).toBe("code {path}");
    expect(ideCommandFor([], {})).toBe("code {path}");
  });
});

describe("buildCommand", () => {
  it("keeps a path with spaces and shell characters as one argument", () => {
    expect(buildCommand("code {path}", "/p/my app; rm -rf ~")).toEqual({
      file: "code",
      args: ["/p/my app; rm -rf ~"],
    });
  });

  it("replaces the placeholder inside a token", () => {
    expect(buildCommand("gnome-terminal --working-directory={path}", "/p/a")).toEqual({
      file: "gnome-terminal",
      args: ["--working-directory=/p/a"],
    });
  });

  it("appends the path when the template has no placeholder", () => {
    expect(buildCommand("code -n", "/p/a")).toEqual({ file: "code", args: ["-n", "/p/a"] });
  });

  it("refuses an empty template", () => {
    expect(buildCommand("   ", "/p/a")).toBeNull();
  });
});

describe("ideLabel", () => {
  it("names known editors and falls back to the command", () => {
    expect(ideLabel("phpstorm {path}")).toBe("PhpStorm");
    expect(ideLabel("/usr/bin/code {path}")).toBe("VS Code");
    expect(ideLabel("nvim {path}")).toBe("nvim");
  });
});
