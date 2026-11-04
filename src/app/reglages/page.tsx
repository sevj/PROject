import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { getHiddenProjects, getRegistry } from "@/server/registry";
import { getSettings } from "@/server/settings";
import { SettingsForm } from "./settings-form";

async function Settings() {
  await connection();
  const db = getDb();
  const { root, ideCommands, terminalCommand } = getSettings(db);
  const { rows, collections } = getRegistry(db);
  const stacks = [...new Set([...rows.flatMap((row) => row.stacks), ...Object.keys(ideCommands)])]
    .filter((stack) => stack !== "default")
    .sort((a, b) => a.localeCompare(b, "fr"));

  return (
    <SettingsForm
      root={root}
      ideCommands={ideCommands}
      terminalCommand={terminalCommand}
      stacks={stacks}
      hidden={getHiddenProjects(db)}
      collections={collections.map((collection) => ({
        ...collection,
        count: rows.filter((row) => row.collectionIds.includes(collection.id)).length,
      }))}
    />
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<main className="flex-1 p-4 font-mono text-[12.5px] text-mut">Chargement…</main>}>
      <Settings />
    </Suspense>
  );
}
