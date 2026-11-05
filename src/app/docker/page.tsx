import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { readDockerOverview } from "@/server/docker-overview";
import { LoadingFallback } from "../loading-fallback";
import { ContainersView } from "./containers-view";

async function Containers() {
  await connection();
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 pt-6 pb-10">
      <ContainersView overview={await readDockerOverview(getDb())} />
    </main>
  );
}

export default function DockerPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Containers />
    </Suspense>
  );
}
