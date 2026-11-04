import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { getRegistry } from "@/server/registry";
import { isSizing } from "@/server/scan/jobs";
import { RegistryView } from "./registry-view";

async function Registry() {
  await connection();
  const { rows, lastScan, now, collections, knownTags } = getRegistry(getDb());
  return (
    <RegistryView
      rows={rows}
      lastScan={lastScan}
      now={now}
      sizing={isSizing()}
      collections={collections}
      knownTags={knownTags}
    />
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main className="flex-1 p-4 font-mono text-[12.5px] text-mut">Chargement…</main>}>
      <Registry />
    </Suspense>
  );
}
