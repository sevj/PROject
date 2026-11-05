import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { saveRequest, saveVariables } from "@/server/http-requests";

/**
 * Not a Server Action, because what is saved here can hold secrets (a token in a header or a
 * variable): in development Next prints the arguments of every Server Action in the terminal.
 * `src/proxy.ts` has refused other sites.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/projects/[id]/http">) {
  await connection();
  const projectId = Number((await params).id);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  if (!Number.isInteger(projectId)) return new Response("Bad Request", { status: 400 });
  const headers = { "Cache-Control": "no-store" };
  if (body.kind === "request") {
    const id = Number.isInteger(body.id) ? (body.id as number) : null;
    return Response.json(saveRequest(getDb(), projectId, id, body.request as Parameters<typeof saveRequest>[3]), { headers });
  }
  if (body.kind === "variables") {
    const environmentId = Number.isInteger(body.environmentId) ? (body.environmentId as number) : null;
    const problem = saveVariables(getDb(), projectId, environmentId, body.variables as Parameters<typeof saveVariables>[3]);
    return Response.json(problem ? { problem } : { ok: true }, { headers });
  }
  return new Response("Bad Request", { status: 400 });
}
