import { describe, expect, it } from "vitest";
import { buildExecSpec, DEFAULT_CONSOLE_OPTIONS, parseConsoleOptions } from "./console-options";

describe("parseConsoleOptions", () => {
  it("defaults to an automatic shell, and trims what it is given", () => {
    expect(parseConsoleOptions(undefined)).toEqual({ options: DEFAULT_CONSOLE_OPTIONS });
    expect(parseConsoleOptions({ shell: "bash", user: " www-data ", workingDir: " /var/www " })).toEqual({
      options: { shell: "bash", command: "", user: "www-data", workingDir: "/var/www" },
    });
  });

  it.each([
    [{ shell: "zsh" }, "shell"],
    [{ shell: 3 }, "shell"],
    [{ shell: "command" }, "command"],
    [{ shell: "command", command: "   " }, "command"],
    [{ command: "x".repeat(1001) }, "command"],
    [{ command: 5 }, "command"],
    [{ user: "root; rm -rf /" }, "user"],
    [{ user: "a b" }, "user"],
    [{ user: "-u" + "x".repeat(70) }, "user"],
    [{ workingDir: "relative/path" }, "workingDir"],
    [{ workingDir: "/a\nb" }, "workingDir"],
    [{ workingDir: "/" + "x".repeat(600) }, "workingDir"],
  ])("refuses %j", (input, field) => {
    expect(parseConsoleOptions(input)).toEqual({ error: field });
  });

  it("accepts a user id with a group, and a named group", () => {
    expect(parseConsoleOptions({ user: "1000:1000" })).toMatchObject({ options: { user: "1000:1000" } });
    expect(parseConsoleOptions({ user: "app:www-data" })).toMatchObject({ options: { user: "app:www-data" } });
  });
});

describe("buildExecSpec", () => {
  it("opens bash when there is one, else sh, with a terminal that has colors", () => {
    const auto = buildExecSpec(DEFAULT_CONSOLE_OPTIONS);
    expect(auto.cmd.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(auto.cmd[2]).toContain("exec bash");
    expect(auto.cmd[2]).toContain("exec sh");
    expect(auto.env).toEqual(["TERM=xterm-256color", "COLORTERM=truecolor"]);
    expect(auto.user).toBeUndefined();
  });

  it("uses the shell, the command, the user and the folder asked for", () => {
    expect(buildExecSpec({ shell: "sh", command: "", user: "", workingDir: "" }).cmd).toEqual(["sh"]);
    expect(buildExecSpec({ shell: "bash", command: "", user: "root", workingDir: "/app" })).toMatchObject({
      cmd: ["bash"],
      user: "root",
      workingDir: "/app",
    });
    expect(buildExecSpec({ shell: "command", command: "php bin/console list", user: "", workingDir: "" }).cmd).toEqual([
      "sh",
      "-c",
      "php bin/console list",
    ]);
  });
});
