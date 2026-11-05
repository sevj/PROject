import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryFolder, readClaudeConfig } from "./claude-config";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-claude-config-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("readClaudeConfig", () => {
  it("is empty in a folder with nothing", async () => {
    expect(await readClaudeConfig(dir)).toMatchObject({ instructions: [], state: "none", mcpServers: [], hooks: [], skills: [] });
  });

  it("reads the instructions, and only the names of what can hold a secret", async () => {
    mkdirSync(join(dir, ".claude", "skills", "deploy"), { recursive: true });
    mkdirSync(join(dir, ".claude", "agents"), { recursive: true });
    writeFileSync(join(dir, ".claude", "agents", "reviewer.md"), "x");
    writeFileSync(join(dir, "CLAUDE.md"), "# Rules\n");
    writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: "run", env: { TOKEN: "s3cret" } } } }));
    writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ command: "s3cret" }] } }));
    const config = await readClaudeConfig(dir);
    expect(config).toMatchObject({ state: "ok", mcpServers: ["db"], hooks: ["PreToolUse"], skills: ["deploy"], agents: ["reviewer.md"] });
    expect(config.instructions[0]).toMatchObject({ name: "CLAUDE.md", lines: 1, content: "# Rules\n" });
    expect(JSON.stringify(config)).not.toContain("s3cret");
  });

  it("survives a broken file, and does not follow a link", async () => {
    const outside = mkdtempSync(join(tmpdir(), "pm-outside-"));
    writeFileSync(join(outside, "private.md"), "private");
    symlinkSync(join(outside, "private.md"), join(dir, "CLAUDE.md"));
    writeFileSync(join(dir, ".mcp.json"), "{ not json");
    expect(await readClaudeConfig(dir)).toMatchObject({ instructions: [], mcpServers: [] });
    rmSync(outside, { recursive: true, force: true });
  });
});

describe("memoryFolder", () => {
  it("names the folder as Claude Code does", () => {
    expect(memoryFolder("/home/me/my.app", "/c")).toBe("/c/projects/-home-me-my-app/memory");
  });
});
