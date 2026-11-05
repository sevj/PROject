import { revalidatePath } from "next/cache";
import { connection } from "next/server";
import { importProject, readConfig } from "@/server/config-share";
import { getDb } from "@/server/db/client";
import { startSizing } from "@/server/scan/jobs";
import { refreshProjects } from "@/server/scan/run";

/**
 * A project from an exported file, into a folder the importer already cloned. `apply` false
 * says what would be done; true does it, then reads the folder as adding a project does.
 */
export async function POST(request: Request) {
  await connection();
  let body: { config?: unknown; directory?: unknown; apply?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const headers = { "Cache-Control": "no-store" };
  const config = readConfig(body.config);
  if (!config) return Response.json({ problem: "invalidFile" }, { headers });
  const result = await importProject(getDb(), typeof body.directory === "string" ? body.directory : "", config, body.apply === true);
  if ("error" in result) return Response.json({ problem: result.error === "noSheet" ? "noSheet" : "directory", detail: result.error }, { headers });
  if (result.projectId !== null) {
    await refreshProjects(getDb(), [result.projectId]);
    startSizing([result.projectId]);
    revalidatePath("/", "layout");
  }
  return Response.json({ project: config.project, ...result }, { headers });
}
