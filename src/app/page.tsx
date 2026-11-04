import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { getRegistry } from "@/server/registry";
import { isSizing } from "@/server/scan/jobs";
import { LoadingFallback } from "./loading-fallback";
import { RegistryView } from "./registry-view";

async function Registry() {
  await connection();
  const { rows, lastScan, now, knownTags } = getRegistry(getDb());
  return (
    <RegistryView
      rows={rows}
      lastScan={lastScan}
      now={now}
      sizing={isSizing()}
      knownTags={knownTags}
    />
  );
}

export default function Home() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Registry />
    </Suspense>
  );
}
