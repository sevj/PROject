import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { getRegistry } from "@/server/registry";
import { Board } from "./board";

async function Organisation() {
  await connection();
  const { rows, collections, now } = getRegistry(getDb());
  return <Board rows={rows} collections={collections} now={now} />;
}

export default function OrganisationPage() {
  return (
    <Suspense fallback={<main className="flex-1 p-4 font-mono text-[12.5px] text-mut">Chargement…</main>}>
      <Organisation />
    </Suspense>
  );
}
