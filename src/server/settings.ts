import { eq } from "drizzle-orm";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n";
import { type CommandAlias, DEFAULT_ALIASES, normalizeAliases } from "@/lib/aliases";
import { DEFAULT_IDE_COMMANDS } from "@/lib/commands";
import { DEFAULT_JOURNAL, type JournalConfig, normalizeJournal } from "@/lib/journal";
import type { Db } from "./db/client";
import { settings } from "./db/schema";

/** One per GitLab instance, for all the projects hosted there. Only the encrypted token is kept. */
export type GitlabToken = { host: string; user: string; tokenSecret: string; savedAt: number };

/** One per GitHub account or organization: a fine-grained token only reaches the repositories of one owner. */
export type GithubToken = { owner: string; user: string; tokenSecret: string; savedAt: number };

export type Settings = {
  locale: Locale;
  ideCommands: Record<string, string>;
  terminalCommand: string;
  journal: JournalConfig;
  aliases: CommandAlias[];
  gitlabTokens: GitlabToken[];
  githubTokens: GithubToken[];
};

export function defaultSettings(): Settings {
  return {
    locale: DEFAULT_LOCALE,
    ideCommands: DEFAULT_IDE_COMMANDS,
    terminalCommand: "gnome-terminal --working-directory={path}",
    journal: DEFAULT_JOURNAL,
    aliases: DEFAULT_ALIASES,
    gitlabTokens: [],
    githubTokens: [],
  };
}

export function getSettings(db: Db): Settings {
  const stored = db.select().from(settings).where(eq(settings.id, 1)).get();
  const { locale, ...rest } = { ...defaultSettings(), ...stored?.value };
  // A language removed since it was chosen must not break the app.
  return { ...rest, gitlabTokens: Array.isArray(rest.gitlabTokens) ? rest.gitlabTokens : [], githubTokens: Array.isArray(rest.githubTokens) ? rest.githubTokens : [], journal: normalizeJournal(rest.journal), aliases: normalizeAliases(rest.aliases), locale: isLocale(locale) ? locale : DEFAULT_LOCALE };
}

export function saveSettings(db: Db, patch: Partial<Settings>) {
  const value = { ...getSettings(db), ...patch };
  db.insert(settings)
    .values({ id: 1, value })
    .onConflictDoUpdate({ target: settings.id, set: { value } })
    .run();
}
