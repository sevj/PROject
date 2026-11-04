import { connection } from "next/server";
import { listJobs } from "@/server/dumps/jobs";

/** Polled by the page while a dump or a load is running: it is the progress. */
export async function GET() {
  await connection();
  return Response.json({ jobs: listJobs(), now: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
