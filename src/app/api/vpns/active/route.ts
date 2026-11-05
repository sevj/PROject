import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { readActiveVpns } from "@/server/vpn";

/** Not a Server Action: the top bar asks every few seconds, and actions wait behind one another. */
export async function GET() {
  await connection();
  return Response.json(await readActiveVpns(getDb()), { headers: { "Cache-Control": "no-store" } });
}
