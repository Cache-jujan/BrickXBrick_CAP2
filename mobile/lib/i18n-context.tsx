import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import messages from "../../shared/i18n/messages.json";
import { initDb, kvGet, kvSet } from "@/lib/sync/db";

export type AppLocale = "en" | "ceb" | "fil";
export const SUPPORTED_LOCALES: AppLocale[] = ["en", "ceb", "fil"];
type InterpolationValues = Record<string, string | number>;
type LocaleContextValue = {
  locale: AppLocale;
  setLanguage: (locale: AppLocale) => void;
  toggleLanguage: () => void;
  t: (key: string, values?: InterpolationValues) => string;
  // Translates a fixed backend value (a status, a category) via the key <prefix>.<value as snake_case>; unknown values are shown as they came.
  tv: (prefix: string, value: string | null | undefined) => string;
  // Formats a date for the chosen language (month names follow it; amounts stay en-PH).
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
  // The locale tag to hand to Intl / toLocaleDateString for the chosen language.
  intlLocale: string;
};

// Cebuano has little Intl data on devices, so it borrows the Filipino month names.
const INTL_LOCALE: Record<AppLocale, string> = { en: "en-PH", ceb: "fil-PH", fil: "fil-PH" };

const LOCALE_KEY = "language";
const LocaleContext = createContext<LocaleContextValue | null>(null);

function safeLocale(value: unknown): AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale) ? (value as AppLocale) : "en";
}

function readSavedLocale(): AppLocale {
  try {
    initDb();
    return safeLocale(kvGet(LOCALE_KEY));
  } catch {
    return "en";
  }
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(readSavedLocale);

  const setLanguage = useCallback((nextLocale: AppLocale) => {
    const next = safeLocale(nextLocale);
    setLocale(next);
    try {
      initDb();
      kvSet(LOCALE_KEY, next);
    } catch {
      // The current session still changes language if local persistence fails.
    }
  }, []);

  // Cycles en -> ceb -> fil. Settings sets a locale directly; this stays for
  // any caller that still wants a single button.
  const toggleLanguage = useCallback(() => {
    setLanguage(SUPPORTED_LOCALES[(SUPPORTED_LOCALES.indexOf(locale) + 1) % SUPPORTED_LOCALES.length]);
  }, [locale, setLanguage]);

  const t = useCallback((key: string, values: InterpolationValues = {}) => {
    const template: string = messages[locale]?.[key as keyof typeof messages.en]
      ?? messages.en[key as keyof typeof messages.en]
      ?? key;
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder
    );
  }, [locale]);

  const tv = useCallback((prefix: string, rawValue: string | null | undefined) => {
    const slug = String(rawValue ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const key = `${prefix}.${slug}` as keyof typeof messages.en;
    return messages[locale]?.[key] ?? messages.en[key] ?? String(rawValue ?? "");
  }, [locale]);

  const formatDate = useCallback((input: string | number | Date, options?: Intl.DateTimeFormatOptions) => {
    const date = input instanceof Date ? input : new Date(input);
    // Date-only inputs are local calendar days; timestamps remain instants.
    if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input) && !Number.isNaN(date.getTime())) {
      const [year, month, day] = input.split("-").map(Number);
      date.setFullYear(year, month - 1, day);
      date.setHours(0, 0, 0, 0);
    }
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(INTL_LOCALE[locale], options ?? { year: "numeric", month: "short", day: "numeric" });
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLanguage, toggleLanguage, t, tv, formatDate, intlLocale: INTL_LOCALE[locale] }),
    [locale, setLanguage, toggleLanguage, t, tv, formatDate]
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used within LocaleProvider");
  return context;
}
