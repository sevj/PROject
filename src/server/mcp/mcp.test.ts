import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, openDb } from "../db/client";
import { envValueHistory, projectFacts, projects } from "../db/schema";
import { handleMcpMessage, MAX_RESULT_CHARS, type McpTool } from "./protocol";
import { isMcpToken, mcpConfig, mcpToken } from "./token";
import { MCP_TOOLS } from "./tools";

vi.mock("@/app/databases/actions", () => ({
  loadColumns: vi.fn(),
  loadDatabases: vi.fn(),
  loadForeignKeys: vi.fn(),
  loadTables: vi.fn(),
}));

const echo: McpTool<null> = { name: "echo", description: "d", inputSchema: {}, run: async (input) => input };
const call = (method: string, params?: unknown, tools = [echo]) => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, tools, null);

describe("handleMcpMessage", () => {
  it("settles on a version both sides know", async () => {
    expect(await call("initialize", { protocolVersion: "2025-03-26" })).toMatchObject({ result: { protocolVersion: "2025-03-26", capabilities: { tools: {} } } });
    expect(await call("initialize", { protocolVersion: "2099-01-01" })).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
  });

  it("answers a ping and nothing to a notification", async () => {
    expect(await call("ping")).toMatchObject({ id: 1, result: {} });
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, [echo], null)).toBeNull();
  });

  it("lists tools as read-only, without how they run", async () => {
    const result = (await call("tools/list")) as { result: { tools: Record<string, unknown>[] } };
    expect(result.result.tools[0]).toEqual({ name: "echo", description: "d", inputSchema: {}, annotations: { readOnlyHint: true } });
  });

  it("gives a tool's answer as text, and its failure as a result the model can read", async () => {
    expect(await call("tools/call", { name: "echo", arguments: { a: 1 } })).toMatchObject({ result: { content: [{ type: "text", text: '{"a":1}' }] } });
    const broken: McpTool<null> = { ...echo, run: async () => { throw new Error("no"); } };
    expect(await call("tools/call", { name: "echo" }, [broken])).toMatchObject({ result: { isError: true, content: [{ text: "no" }] } });
  });

  it("cuts what would flood the conversation", async () => {
    const big: McpTool<null> = { ...echo, run: async () => "x".repeat(MAX_RESULT_CHARS * 2) };
    const result = (await call("tools/call", { name: "echo" }, [big])) as { result: { content: { text: string }[] } };
    expect(result.result.content[0].text.length).toBeLessThan(MAX_RESULT_CHARS + 20);
  });

  it("refuses what it does not know, or cannot read", async () => {
    expect(await call("resources/list")).toMatchObject({ error: { code: -32601 } });
    expect(await call("tools/call", { name: "nope" })).toMatchObject({ error: { code: -32602 } });
    expect(await handleMcpMessage(null, [echo], null)).toMatchObject({ error: { code: -32600 } });
  });
});

describe("the token", () => {
  it("only opens with the exact value", () => {
    expect(isMcpToken(`Bearer ${mcpToken()}`)).toBe(true);
    for (const header of [null, "", mcpToken(), "Bearer wrong", `Bearer ${mcpToken()}x`]) expect(isMcpToken(header)).toBe(false);
  });

  it("is given to a console with its project", () => {
    expect(JSON.parse(mcpConfig("127.0.0.1:4300", 7)).mcpServers["project-manager"]).toEqual({
      type: "http",
      url: "http://127.0.0.1:4300/api/mcp",
      headers: { Authorization: `Bearer ${mcpToken()}`, "X-PM-Project": "7" },
    });
  });
});

describe("MCP_TOOLS", () => {
  let db: Db;
  let dir: string;
  let id: number;
  const tool = (name: string) => MCP_TOOLS.find((item) => item.name === name)!;

  beforeEach(() => {
    db = openDb(":memory:");
    dir = mkdtempSync(join(tmpdir(), "pm-mcp-"));
    id = db.insert(projects).values({ path: dir, name: "shop" }).returning({ id: projects.id }).get().id;
    db.insert(projectFacts).values({ projectId: id }).run();
    db.insert(envValueHistory).values({ projectId: id, key: "API_KEY", value: "s3cret", origin: "edit" }).run();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("lists the projects, leaving out the abandoned ones", async () => {
    const other = db.insert(projects).values({ path: `${dir}/x`, name: "old", abandoned: true }).returning({ id: projects.id }).get().id;
    db.insert(projectFacts).values({ projectId: other }).run();
    const rows = (await tool("list_projects").run({}, { db, projectId: null })) as { name: string }[];
    expect(rows.map(({ name }) => name)).toEqual(["shop"]);
  });

  it("defaults to the project of the console, finds another by name, and says when it cannot", async () => {
    const setup = tool("get_claude_setup");
    await expect(setup.run({}, { db, projectId: id })).resolves.toMatchObject({ state: "none" });
    await expect(setup.run({ project: "SHOP" }, { db, projectId: null })).resolves.toMatchObject({ state: "none" });
    await expect(setup.run({}, { db, projectId: null })).rejects.toThrow("list_projects");
    await expect(setup.run({ project: "nope" }, { db, projectId: id })).rejects.toThrow("No project");
  });

  it("does not hand out what the app keeps of the environment", async () => {
    const all = JSON.stringify(await tool("get_project").run({}, { db, projectId: id }));
    expect(all).not.toContain("s3cret");
    expect(all).not.toContain("API_KEY");
  });

  it("offers no tool that reads rows or changes anything", () => {
    expect(MCP_TOOLS.map(({ name }) => name).every((name) => /^(list|get)_/.test(name))).toBe(true);
  });
});
