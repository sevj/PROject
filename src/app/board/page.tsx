import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { getRegistry } from "@/server/registry";
import { LoadingFallback } from "../loading-fallback";
import { Board } from "./board";

async function BoardData() {
  await connection();
  const { rows, knownTags, now } = getRegistry(getDb());
  return <Board rows={rows} knownTags={knownTags} now={now} />;
}

export default function BoardPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <BoardData />
    </Suspense>
  );
}
