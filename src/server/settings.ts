import { eq } from "drizzle-orm";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n";
import { DEFAULT_IDE_COMMANDS } from "@/lib/commands";
import type { Db } from "./db/client";
import { settings } from "./db/schema";

export type Settings = {
  locale: Locale;
  ideCommands: Record<string, string>;
  terminalCommand: string;
};

export function defaultSettings(): Settings {
  return {
    locale: DEFAULT_LOCALE,
    ideCommands: DEFAULT_IDE_COMMANDS,
    terminalCommand: "gnome-terminal --working-directory={path}",
  };
}

export function getSettings(db: Db): Settings {
  const stored = db.select().from(settings).where(eq(settings.id, 1)).get();
  const { locale, ...rest } = { ...defaultSettings(), ...stored?.value };
  // A language removed since it was chosen must not break the app.
  return { ...rest, locale: isLocale(locale) ? locale : DEFAULT_LOCALE };
}

export function saveSettings(db: Db, patch: Partial<Settings>) {
  const value = { ...getSettings(db), ...patch };
  db.insert(settings)
    .values({ id: 1, value })
    .onConflictDoUpdate({ target: settings.id, set: { value } })
    .run();
}
