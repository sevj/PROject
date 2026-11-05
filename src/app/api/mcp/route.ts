import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { handleMcpMessage } from "@/server/mcp/protocol";
import { isMcpToken } from "@/server/mcp/token";
import { MCP_TOOLS } from "@/server/mcp/tools";

/**
 * What the Claude consoles of the app can ask it. `src/proxy.ts` has already refused other sites,
 * and only a console holds the token. Read-only: see the tools.
 */
export async function POST(request: Request) {
  await connection();
  if (!isMcpToken(request.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  let message: unknown;
  try {
    message = await request.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const project = Number(request.headers.get("x-pm-project"));
  const answer = await handleMcpMessage(message, MCP_TOOLS, {
    db: getDb(),
    projectId: Number.isInteger(project) && project > 0 ? project : null,
  });
  return answer ? Response.json(answer) : new Response(null, { status: 202 });
}

/** Nothing is ever sent unasked, so there is no stream to open and no session to end. */
const notAllowed = () => new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
export { notAllowed as GET, notAllowed as DELETE };
