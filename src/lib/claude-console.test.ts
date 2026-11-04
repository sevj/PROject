import { describe, expect, it } from "vitest";
import { claudeArguments, claudeEnvironment, isSessionId } from "./claude-console";

const ID = "24e58f29-84d6-4eed-930f-68d02b4aae30";

describe("isSessionId", () => {
  it("accepts a session id and nothing that could be an option", () => {
    expect(isSessionId(ID)).toBe(true);
    for (const value of ["", "--dangerously-skip-permissions", `${ID} --help`, `${ID}\n`, null, 12]) {
      expect(isSessionId(value)).toBe(false);
    }
  });
});

describe("claudeArguments", () => {
  it("names the session of a new conversation, or the one to resume", () => {
    expect(claudeArguments({ id: ID, resume: false })).toEqual(["--session-id", ID]);
    expect(claudeArguments({ id: ID, resume: true })).toEqual(["--resume", ID]);
  });
});

describe("claudeEnvironment", () => {
  const env = claudeEnvironment({
    HOME: "/home/me",
    PATH: "/bin",
    ANTHROPIC_API_KEY: "kept",
    CLAUDE_CONFIG_DIR: "/config",
    TERM: "dumb",
    NODE_ENV: "development",
    NODE_OPTIONS: "--inspect",
    NODE_CHANNEL_FD: "3",
    NEXT_RUNTIME: "nodejs",
    __NEXT_DEV_SERVER: "1",
    TURBOPACK: "1",
    PORT: "4300",
    npm_lifecycle_event: "dev",
    PM_DB_PATH: "/db",
    CLAUDECODE: "1",
    UNSET: undefined,
  });

  it("keeps what belongs to the user", () => {
    expect(env).toMatchObject({
      HOME: "/home/me",
      PATH: "/bin",
      ANTHROPIC_API_KEY: "kept",
      CLAUDE_CONFIG_DIR: "/config",
    });
  });

  it("leaves out what belongs to the server of the app", () => {
    expect(Object.keys(env).sort()).toEqual(
      ["ANTHROPIC_API_KEY", "CLAUDE_CONFIG_DIR", "COLORTERM", "HOME", "PATH", "TERM"].sort(),
    );
  });

  it("describes the terminal it really runs in", () => {
    expect(env).toMatchObject({ TERM: "xterm-256color", COLORTERM: "truecolor" });
  });
});
