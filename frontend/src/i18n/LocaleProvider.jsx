import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import messages from "../../../shared/i18n/messages.json";

const STORAGE_KEY = "brickxbrick.locale.v1";
export const SUPPORTED_LOCALES = ["en", "ceb", "fil"];
const LocaleContext = createContext(null);

// Amounts keep the en-PH grouping (₱1,234.50) in every language. Browsers have
// little Intl data for Cebuano, so it borrows the Filipino month names.
const INTL_LOCALE = { en: "en-PH", ceb: "fil-PH", fil: "fil-PH" };

function safeLocale(value) {
  return SUPPORTED_LOCALES.includes(value) ? value : "en";
}

function readSavedLocale() {
  try {
    return safeLocale(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "en";
  }
}

export function LocaleProvider({ children }) {
  const [locale, setLocale] = useState(readSavedLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    function syncOtherTab(event) {
      if (event.key === STORAGE_KEY) setLocale(safeLocale(event.newValue));
    }
    window.addEventListener("storage", syncOtherTab);
    return () => window.removeEventListener("storage", syncOtherTab);
  }, []);

  const setLanguage = useCallback((nextLocale) => {
    const next = safeLocale(nextLocale);
    setLocale(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Keep the language change active for this tab if browser storage is blocked.
    }
  }, []);

  // Cycles en -> ceb -> fil. The language switcher sets a locale directly;
  // this stays for any caller that still wants a single button.
  const toggleLanguage = useCallback(() => {
    setLanguage(SUPPORTED_LOCALES[(SUPPORTED_LOCALES.indexOf(locale) + 1) % SUPPORTED_LOCALES.length]);
  }, [locale, setLanguage]);

  // Current language, then English, then the key itself, so a missing
  // translation never blanks a screen.
  const t = useCallback((key, values = {}) => {
    const template = messages[locale]?.[key] ?? messages.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (placeholder, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : placeholder
    );
  }, [locale]);

  // Translates a fixed backend value (a status, a category) through the catalog key
  // `<prefix>.<value as snake_case>`. Anything not in the catalog is shown as it came.
  const tv = useCallback((prefix, rawValue) => {
    const slug = String(rawValue ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
    const key = `${prefix}.${slug}`;
    return messages[locale]?.[key] ?? messages.en[key] ?? rawValue;
  }, [locale]);

  const intlLocale = INTL_LOCALE[locale];
  const formatDate = useCallback(
    (value, options = { year: "numeric", month: "short", day: "numeric" }) => {
      const date = value instanceof Date ? value : new Date(value);
      // Date-only inputs are local calendar days; timestamps remain instants.
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime())) {
        const [year, month, day] = value.split("-").map(Number);
        date.setFullYear(year, month - 1, day);
        date.setHours(0, 0, 0, 0);
      }
      return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(intlLocale, options).format(date);
    },
    [intlLocale]
  );
  const formatPeso = useCallback(
    (value, options = {}) =>
      new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0, ...options }).format(Number(value) || 0),
    []
  );
  const formatNumber = useCallback(
    (value, options = {}) => new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2, ...options }).format(Number(value) || 0),
    []
  );

  const value = useMemo(
    () => ({ locale, setLanguage, toggleLanguage, t, tv, formatDate, formatPeso, formatNumber }),
    [locale, setLanguage, toggleLanguage, t, tv, formatDate, formatPeso, formatNumber]
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside LocaleProvider");
  return context;
}
