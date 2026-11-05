import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { saveVpn, type VpnInput } from "@/server/vpn";

/** Passwords stay off Server Actions, whose arguments Next can print. `src/proxy.ts` has refused other sites. */
export async function POST(request: Request) {
  await connection();
  const body = (await request.json().catch(() => null)) as VpnInput | null;
  if (!body || !["openvpn", "sudo_openvpn", "nordlayer"].includes(body.kind)) return new Response("Bad Request", { status: 400 });
  return Response.json(await saveVpn(getDb(), null, body), { headers: { "Cache-Control": "no-store" } });
}
