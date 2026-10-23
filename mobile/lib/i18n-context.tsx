import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import messages from "../../shared/i18n/messages.json";
import { initDb, kvGet, kvSet } from "@/lib/sync/db";

export type AppLocale = "en" | "ceb";
type InterpolationValues = Record<string, string | number>;
type LocaleContextValue = {
  locale: AppLocale;
  setLanguage: (locale: AppLocale) => void;
  toggleLanguage: () => void;
  t: (key: string, values?: InterpolationValues) => string;
};

const LOCALE_KEY = "language";
const LocaleContext = createContext<LocaleContextValue | null>(null);

function readSavedLocale(): AppLocale {
  try {
    initDb();
    return kvGet(LOCALE_KEY) === "ceb" ? "ceb" : "en";
  } catch {
    return "en";
  }
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(readSavedLocale);

  const setLanguage = useCallback((nextLocale: AppLocale) => {
    const safeLocale: AppLocale = nextLocale === "ceb" ? "ceb" : "en";
    setLocale(safeLocale);
    try {
      initDb();
      kvSet(LOCALE_KEY, safeLocale);
    } catch {
      // The current session still changes language if local persistence fails.
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(locale === "ceb" ? "en" : "ceb");
  }, [locale, setLanguage]);

  const t = useCallback((key: string, values: InterpolationValues = {}) => {
    const template: string = messages[locale]?.[key as keyof typeof messages.en]
      ?? messages.en[key as keyof typeof messages.en]
      ?? key;
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder
    );
  }, [locale]);

  const value = useMemo(() => ({ locale, setLanguage, toggleLanguage, t }), [locale, setLanguage, toggleLanguage, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used within LocaleProvider");
  return context;
}
