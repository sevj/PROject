import { eq } from "drizzle-orm";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { DEFAULT_IDE_COMMANDS } from "@/lib/commands";
import type { Db } from "./db/client";
import { settings } from "./db/schema";

export type Settings = {
  root: string;
  ideCommands: Record<string, string>;
  terminalCommand: string;
};

export function defaultSettings(): Settings {
  return {
    root: process.env.PM_ROOT || join(homedir(), "Projects"),
    ideCommands: DEFAULT_IDE_COMMANDS,
    terminalCommand: "gnome-terminal --working-directory={path}",
  };
}

export function getSettings(db: Db): Settings {
  const stored = db.select().from(settings).where(eq(settings.id, 1)).get();
  return { ...defaultSettings(), ...stored?.value };
}

export function saveSettings(db: Db, patch: Partial<Settings>): string | null {
  if (patch.root !== undefined && !isAbsolute(patch.root)) {
    return "Le dossier racine doit être un chemin absolu.";
  }
  const value = { ...getSettings(db), ...patch };
  db.insert(settings)
    .values({ id: 1, value })
    .onConflictDoUpdate({ target: settings.id, set: { value } })
    .run();
  return null;
}
