import { type Messages, messagesFor } from "@/i18n";
import type { Db } from "./db/client";
import { getSettings } from "./settings";

export function serverMessages(db: Db): Messages {
  return messagesFor(getSettings(db).locale);
}
