import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { readProjectMap } from "@/server/project-map";
import { LoadingFallback } from "../loading-fallback";
import { MapView } from "./map-view";

async function ProjectMapPage() {
  await connection();
  return (
    <main className="mx-auto w-full max-w-[1500px] flex-1 px-5 pt-6 pb-10">
      <MapView map={await readProjectMap(getDb())} />
    </main>
  );
}

export default function MapPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ProjectMapPage />
    </Suspense>
  );
}
