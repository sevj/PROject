import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { readPaletteData } from "@/server/palette";

/** Read each time the palette opens. */
export async function GET() {
  await connection();
  return Response.json(await readPaletteData(getDb()), { headers: { "Cache-Control": "no-store" } });
}
