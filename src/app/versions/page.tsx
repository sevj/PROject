import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { readVersionsReport } from "@/server/versions";
import { LoadingFallback } from "../loading-fallback";
import { VersionsView } from "./versions-view";

async function Versions() {
  await connection();
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 pt-6 pb-10">
      <VersionsView report={await readVersionsReport(getDb())} />
    </main>
  );
}

export default function VersionsPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Versions />
    </Suspense>
  );
}
