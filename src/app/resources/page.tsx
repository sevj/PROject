import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { readDisk } from "@/server/resources";
import { LoadingFallback } from "../loading-fallback";
import { ResourcesView } from "./resources-view";

async function Resources() {
  await connection();
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 pt-6 pb-10">
      <ResourcesView disk={await readDisk(getDb())} />
    </main>
  );
}

export default function ResourcesPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Resources />
    </Suspense>
  );
}
