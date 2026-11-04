import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { getRegistry } from "@/server/registry";
import { getSettings } from "@/server/settings";
import { LoadingFallback } from "../loading-fallback";
import { SettingsForm } from "./settings-form";

async function Settings() {
  await connection();
  const db = getDb();
  const { ideCommands, terminalCommand, locale } = getSettings(db);
  const { rows, knownTags } = getRegistry(db);
  const stacks = [...new Set([...rows.flatMap((row) => row.stacks), ...Object.keys(ideCommands)])]
    .filter((stack) => stack !== "default")
    .sort((a, b) => a.localeCompare(b, "fr"));

  return (
    <SettingsForm
      locale={locale}
      ideCommands={ideCommands}
      terminalCommand={terminalCommand}
      stacks={stacks}
      tags={knownTags.map((name) => ({ name, count: rows.filter((row) => row.tags.includes(name)).length }))}
    />
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Settings />
    </Suspense>
  );
}
