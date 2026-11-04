import { connection } from "next/server";
import { readStats } from "@/server/resources";

/** Polled by the Resources page while it is open: one sample of every running container. */
export async function GET() {
  await connection();
  return Response.json(await readStats(), { headers: { "Cache-Control": "no-store" } });
}
