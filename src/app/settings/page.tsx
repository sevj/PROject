import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { listGithubAccounts } from "@/server/github";
import { listGitlabAccounts } from "@/server/gitlab";
import { getRegistry } from "@/server/registry";
import { getSettings } from "@/server/settings";
import { LoadingFallback } from "../loading-fallback";
import { ForgeTokens } from "./forge-tokens";
import { SettingsForm } from "./settings-form";

/** Read outside the component: when the page is made is what the ages are counted from. */
const readForges = (db: ReturnType<typeof getDb>) => ({
  gitlab: listGitlabAccounts(db).map(({ host, ...account }) => ({ name: host, ...account })),
  github: listGithubAccounts(db).map(({ owner, ...account }) => ({ name: owner, ...account })),
  now: Date.now(),
});

async function Settings() {
  await connection();
  const db = getDb();
  const { ideCommands, terminalCommand, locale, aliases } = getSettings(db);
  const { rows, knownTags } = getRegistry(db);
  const forges = readForges(db);
  const stacks = [...new Set([...rows.flatMap((row) => row.stacks), ...Object.keys(ideCommands)])]
    .filter((stack) => stack !== "default")
    .sort((a, b) => a.localeCompare(b, "fr"));

  return (
    <SettingsForm
      locale={locale}
      ideCommands={ideCommands}
      terminalCommand={terminalCommand}
      aliases={aliases}
      stacks={stacks}
      forges={
        <>
          <ForgeTokens forge="gitlab" accounts={forges.gitlab} now={forges.now} />
          <ForgeTokens forge="github" accounts={forges.github} now={forges.now} />
        </>
      }
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
