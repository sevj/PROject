export type McpTool<Context> = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>, context: Context) => Promise<unknown>;
};

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

/** A newer client settles for this. */
const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED = new Set(["2024-11-05", "2025-03-26", PROTOCOL_VERSION]);

/** Much more than this would only fill the conversation it is read into. */
export const MAX_RESULT_CHARS = 200_000;

const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const failure = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** What a tool found, or why not: told to the model as a result, so that it can go on. */
const toolResult = (text: string, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

/** MCP over one HTTP request per message: nothing is kept between them. Null for a notification, which gets no answer. */
export async function handleMcpMessage<Context>(message: unknown, tools: McpTool<Context>[], context: Context): Promise<object | null> {
  const { id, method, params } = (message ?? {}) as Message;
  if (typeof method !== "string") return failure(id, -32600, "Invalid request");
  if (id === undefined || id === null) return null;

  const input = (params ?? {}) as { protocolVersion?: unknown; name?: unknown; arguments?: unknown };
  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: typeof input.protocolVersion === "string" && SUPPORTED.has(input.protocolVersion) ? input.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "project-manager", version: "1.0.0" },
        instructions:
          "What PROJect knows about the local projects, from outside any single folder: containers, addresses, ports, stored analyses, the user's status and notes, database structure. Read-only. Never holds environment values or database rows.",
      });
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: { readOnlyHint: true } })),
      });
    case "tools/call": {
      const tool = tools.find(({ name }) => name === input.name);
      if (!tool) return failure(id, -32602, `Unknown tool: ${String(input.name)}`);
      try {
        const text = JSON.stringify(await tool.run((input.arguments ?? {}) as Record<string, unknown>, context));
        return reply(id, toolResult(text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}… (cut)` : text));
      } catch (error) {
        return reply(id, toolResult(error instanceof Error ? error.message : String(error), true));
      }
    }
    default:
      return failure(id, -32601, `Method not found: ${method}`);
  }
}
