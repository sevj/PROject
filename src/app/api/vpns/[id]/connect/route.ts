import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { connectVpn } from "@/server/vpn";

/**
 * Carries a token, and takes up to a minute: as a Server Action it would be printed in development,
 * and every other action of the page would wait behind it. `src/proxy.ts` has refused other sites.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/vpns/[id]/connect">) {
  await connection();
  const id = Number((await params).id);
  const body = (await request.json().catch(() => null)) as { password?: unknown; token?: unknown } | null;
  if (!Number.isInteger(id) || !body) return new Response("Bad Request", { status: 400 });
  return Response.json(await connectVpn(getDb(), id, body), { headers: { "Cache-Control": "no-store" } });
}
