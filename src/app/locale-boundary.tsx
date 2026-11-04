import { connection } from "next/server";
import type { ReactNode } from "react";
import { I18nProvider } from "@/i18n/provider";
import { getDb } from "@/server/db/client";
import { getSettings } from "@/server/settings";

export async function LocaleBoundary({ children }: { children: ReactNode }) {
  await connection();
  return <I18nProvider locale={getSettings(getDb()).locale}>{children}</I18nProvider>;
}
