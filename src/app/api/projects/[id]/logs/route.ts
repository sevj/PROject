import { connection } from "next/server";
import { LOG_RESUME_MS, mergeLogStreams, MERGED_LOG_TAIL, streamContainerLogs } from "@/server/container-logs";
import { getDb } from "@/server/db/client";
import { listProjectContainers } from "@/server/docker-containers";

/** All the containers of a project together, followed by the logs panel while it is open. */
export async function GET(request: Request, context: RouteContext<"/api/projects/[id]/logs">) {
  await connection();
  const { id } = await context.params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) return new Response("Not found", { status: 404 });

  const live = await listProjectContainers(getDb(), projectId);
  if (live.error) return new Response(live.error, { status: 503 });
  if (live.containers.length === 0) return new Response("Not found", { status: 404 });

  const sources = live.containers.map(({ id: containerId, name, service }) => ({
    name: service || name,
    stream: streamContainerLogs(containerId, { signal: request.signal, resumeMs: LOG_RESUME_MS, tail: MERGED_LOG_TAIL }),
  }));
  return new Response(mergeLogStreams(sources), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Compressing would hold lines back until there are enough of them.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
