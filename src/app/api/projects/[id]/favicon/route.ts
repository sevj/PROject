import { eq } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { readFavicon } from "@/server/project-favicon";

/** The project's own icon, so the list can tell projects apart at a glance. */
export async function GET(_request: Request, context: RouteContext<"/api/projects/[id]/favicon">) {
  await connection();
  const { id } = await context.params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) return new Response("Not found", { status: 404 });

  const project = getDb().select({ path: projects.path }).from(projects).where(eq(projects.id, projectId)).get();
  const favicon = project ? await readFavicon(project.path) : null;
  if (!favicon) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(favicon.body), {
    headers: {
      "Content-Type": favicon.type,
      // The URL carries the file's modification time, so a changed icon gets a new URL.
      "Cache-Control": "private, max-age=86400",
      // An SVG opened on its own must not run scripts.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
