import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { listVpns } from "@/server/vpn";
import { LoadingFallback } from "../loading-fallback";
import { VpnView as VpnPage } from "./vpn-view";

async function Vpns() {
  await connection();
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 pt-6 pb-10">
      <VpnPage vpns={await listVpns(getDb())} />
    </main>
  );
}

export default function VpnsPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Vpns />
    </Suspense>
  );
}
