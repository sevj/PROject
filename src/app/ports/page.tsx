import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { readPorts } from "@/server/ports";
import { LoadingFallback } from "../loading-fallback";
import { PortsView } from "./ports-view";

async function Ports() {
  await connection();
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 pt-6 pb-10">
      <PortsView report={await readPorts(getDb())} />
    </main>
  );
}

export default function PortsPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Ports />
    </Suspense>
  );
}
