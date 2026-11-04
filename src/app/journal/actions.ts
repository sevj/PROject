"use server";

import { revalidatePath } from "next/cache";
import { normalizeJournal } from "@/lib/journal";
import { getDb } from "@/server/db/client";
import { saveSettings } from "@/server/settings";

/** Whatever comes in is brought back to a sane configuration before it is kept. */
export async function saveJournalConfig(input: {
  gapMinutes: number;
  paddingMinutes: number;
  commits: boolean;
  claude: boolean;
  files: boolean;
}): Promise<void> {
  saveSettings(getDb(), {
    journal: normalizeJournal({
      gapMinutes: Number(input.gapMinutes),
      paddingMinutes: Number(input.paddingMinutes),
      commits: input.commits === true,
      claude: input.claude === true,
      files: input.files === true,
    }),
  });
  revalidatePath("/journal");
}
