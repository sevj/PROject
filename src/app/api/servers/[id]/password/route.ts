import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { keepPassword } from "@/server/remote-servers";

/** Passwords stay off Server Actions, whose arguments Next can print. `src/proxy.ts` has refused other sites. */
export async function PUT(request: Request, { params }: RouteContext<"/api/servers/[id]/password">) {
  await connection();
  const id = Number((await params).id);
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  if (!Number.isInteger(id) || typeof body?.password !== "string") return new Response("Bad Request", { status: 400 });
  return new Response(null, { status: keepPassword(getDb(), id, body.password) ? 204 : 409 });
}
