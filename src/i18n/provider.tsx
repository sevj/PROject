"use client";

import { createContext, type ReactNode, useContext, useEffect } from "react";
import { DEFAULT_LOCALE, type Locale, type Messages, messagesFor } from ".";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  // The root layout is static, so it cannot know the language when it renders <html>.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useMessages(): Messages {
  return messagesFor(useContext(LocaleContext));
}
