import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { dumpPath, getDump, stashDir } from "@/server/dumps/store";

export async function GET(_request: Request, context: RouteContext<"/api/dumps/[id]/file">) {
  await connection();
  const { id } = await context.params;
  const dump = Number.isInteger(Number(id)) ? getDump(getDb(), Number(id)) : undefined;
  const path = dump?.status === "done" ? dumpPath(stashDir(), dump.fileName) : null;
  if (!dump || !path) return new Response("Not found", { status: 404 });

  const size = await stat(path).then(({ size }) => size, () => null);
  if (size === null) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${basename(dump.fileName).replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
