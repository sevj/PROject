import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { saveVpn, type VpnInput } from "@/server/vpn";

/** See `api/vpns`: this carries a password. */
export async function PUT(request: Request, { params }: RouteContext<"/api/vpns/[id]">) {
  await connection();
  const id = Number((await params).id);
  const body = (await request.json().catch(() => null)) as VpnInput | null;
  if (!Number.isInteger(id) || !body) return new Response("Bad Request", { status: 400 });
  return Response.json(await saveVpn(getDb(), id, body), { headers: { "Cache-Control": "no-store" } });
}
