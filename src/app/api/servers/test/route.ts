import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { testConnection } from "@/server/remote-servers";

/**
 * Not a Server Action, because this request can carry a password: in development Next prints
 * the arguments of every Server Action in the terminal. `src/proxy.ts` has refused other sites.
 */
export async function POST(request: Request) {
  await connection();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const { serverId, accessId, password, remember } = body;
  if (!Number.isInteger(serverId)) return new Response("Bad Request", { status: 400 });
  return Response.json(
    await testConnection(getDb(), {
      serverId: serverId as number,
      accessId: Number.isInteger(accessId) ? (accessId as number) : undefined,
      password: typeof password === "string" ? password : undefined,
      remember: remember === true,
    }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
