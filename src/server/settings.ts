import { eq } from "drizzle-orm";
import { DEFAULT_IDE_COMMANDS } from "@/lib/commands";
import type { Db } from "./db/client";
import { settings } from "./db/schema";

export type Settings = {
  ideCommands: Record<string, string>;
  terminalCommand: string;
};

export function defaultSettings(): Settings {
  return {
    ideCommands: DEFAULT_IDE_COMMANDS,
    terminalCommand: "gnome-terminal --working-directory={path}",
  };
}

export function getSettings(db: Db): Settings {
  const stored = db.select().from(settings).where(eq(settings.id, 1)).get();
  return { ...defaultSettings(), ...stored?.value };
}

export function saveSettings(db: Db, patch: Partial<Settings>) {
  const value = { ...getSettings(db), ...patch };
  db.insert(settings)
    .values({ id: 1, value })
    .onConflictDoUpdate({ target: settings.id, set: { value } })
    .run();
}
