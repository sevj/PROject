import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { readStash } from "@/server/dumps/stash";
import { LoadingFallback } from "../loading-fallback";
import { DumpStash } from "./dump-stash";

async function Stash() {
  await connection();
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 pt-6 pb-10">
      <DumpStash {...await readStash(getDb())} />
    </main>
  );
}

export default function DumpsPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Stash />
    </Suspense>
  );
}
