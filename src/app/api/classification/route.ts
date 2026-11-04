import { connection } from "next/server";
import { exportClassification } from "@/server/classification";
import { getDb } from "@/server/db/client";

export async function GET() {
  await connection();
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(exportClassification(getDb()), null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="project-manager-classement-${date}.json"`,
    },
  });
}
