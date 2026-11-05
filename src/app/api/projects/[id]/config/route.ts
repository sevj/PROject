import { revalidatePath } from "next/cache";
import { connection } from "next/server";
import { exportProject, importInto, readConfig } from "@/server/config-share";
import { getDb } from "@/server/db/client";
import { getProject } from "@/server/registry";

const slug = (name: string) => name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";

/** The project's configuration as a file to hand to a colleague: no password, key or secret in it. */
export async function GET(_request: Request, { params }: RouteContext<"/api/projects/[id]/config">) {
  await connection();
  const project = getProject(getDb(), Number((await params).id));
  if (!project) return new Response("Not Found", { status: 404 });
  const config = exportProject(getDb(), project.row.id);
  if (!config) return new Response("Not Found", { status: 404 });
  return new Response(`${JSON.stringify(config, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug(project.row.name)}.project-manager.json"`,
      "Cache-Control": "no-store",
    },
  });
}

/** `apply` false says what would be done; true does it. */
export async function POST(request: Request, { params }: RouteContext<"/api/projects/[id]/config">) {
  await connection();
  const project = getProject(getDb(), Number((await params).id));
  if (!project) return new Response("Not Found", { status: 404 });
  let body: { config?: unknown; apply?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const config = readConfig(body.config);
  if (!config) return Response.json({ problem: "invalidFile" }, { headers: { "Cache-Control": "no-store" } });
  const result = await importInto(getDb(), project.row.id, config, body.apply === true);
  if (body.apply === true) revalidatePath("/", "layout");
  return Response.json({ project: config.project, ...result }, { headers: { "Cache-Control": "no-store" } });
}
