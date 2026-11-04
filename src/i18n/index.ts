import { en, type Messages } from "./en";
import { fr } from "./fr";

export type { Messages };

/** To add a language: a file next to `fr.ts`, and one line here. */
export const LANGUAGES = {
  en: { label: "English", messages: en },
  fr: { label: "Français", messages: fr },
} satisfies Record<string, { label: string; messages: Messages }>;

export type Locale = keyof typeof LANGUAGES;

export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && Object.keys(LANGUAGES).includes(value);
}

export function messagesFor(locale: Locale): Messages {
  return LANGUAGES[locale].messages;
}
