import { count } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { projects } from "@/server/db/schema";

async function ProjectCount() {
  await connection();
  const [{ total }] = getDb().select({ total: count() }).from(projects).all();
  return (
    <p className="font-mono text-[12.5px] text-mut">
      {total === 0 ? "Aucun projet scanné pour l'instant." : `${total} projets en base.`}
    </p>
  );
}

export default function Home() {
  return (
    <main className="flex-1 p-4">
      <Suspense>
        <ProjectCount />
      </Suspense>
    </main>
  );
}
