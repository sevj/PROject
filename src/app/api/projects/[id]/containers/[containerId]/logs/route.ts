import { connection } from "next/server";
import { streamContainerLogs } from "@/server/container-logs";
import { getDb } from "@/server/db/client";
import { listProjectContainers } from "@/server/docker-containers";

/** Followed by the logs panel while it is open. The id only counts if it is one of the project's. */
export async function GET(request: Request, context: RouteContext<"/api/projects/[id]/containers/[containerId]/logs">) {
  await connection();
  const { id, containerId } = await context.params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) return new Response("Not found", { status: 404 });

  const live = await listProjectContainers(getDb(), projectId);
  if (live.error) return new Response(live.error, { status: 503 });
  const container = live.containers.find((candidate) => candidate.id === containerId);
  if (!container) return new Response("Not found", { status: 404 });

  return new Response(streamContainerLogs(container.id, { signal: request.signal }), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Compressing would hold lines back until there are enough of them.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
