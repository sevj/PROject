import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { listServers, readSuggestions } from "@/server/remote-servers";
import { listVpns } from "@/server/vpn";
import { LoadingFallback } from "../loading-fallback";
import { ServersView } from "./servers-view";

async function Servers() {
  await connection();
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 pt-6 pb-10">
      <ServersView servers={listServers(getDb())} suggestions={await readSuggestions()} vpns={await listVpns(getDb())} />
    </main>
  );
}

export default function ServersPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Servers />
    </Suspense>
  );
}
