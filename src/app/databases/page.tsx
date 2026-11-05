import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { listDatabaseServers, publicTarget, redisTarget } from "@/server/dumps/containers";
import { listSqliteTargets } from "@/server/sqlite";
import { readHistories } from "@/server/query-history";
import { LoadingFallback } from "../loading-fallback";
import { DatabasesView } from "./databases-view";

async function Databases({ searchParams }: { searchParams: Promise<{ container?: string }> }) {
  await connection();
  const { container } = await searchParams;
  const { containers, redis, error } = await listDatabaseServers(getDb());
  const targets = [...containers.map(publicTarget), ...redis.map(redisTarget), ...listSqliteTargets(getDb())];
  const initial = targets.find(({ name }) => name === container)?.id ?? null;
  const { histories, now } = readHistories(getDb(), targets.map(({ projectId }) => projectId));
  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 pt-6 pb-10">
      <DatabasesView targets={targets} error={error} initialContainer={initial} histories={histories} initialNow={now} />
    </main>
  );
}

export default function DatabasesPage({ searchParams }: PageProps<"/databases">) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Databases searchParams={searchParams as Promise<{ container?: string }>} />
    </Suspense>
  );
}
