import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import messages from "../../../shared/i18n/messages.json";

const STORAGE_KEY = "brickxbrick.locale.v1";
const LocaleContext = createContext(null);

function readSavedLocale() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "ceb" ? "ceb" : "en";
  } catch {
    return "en";
  }
}

export function LocaleProvider({ children }) {
  const [locale, setLocale] = useState(readSavedLocale);

  useEffect(() => {
    document.documentElement.lang = locale === "ceb" ? "ceb" : "en";
  }, [locale]);

  useEffect(() => {
    function syncOtherTab(event) {
      if (event.key === STORAGE_KEY) setLocale(event.newValue === "ceb" ? "ceb" : "en");
    }
    window.addEventListener("storage", syncOtherTab);
    return () => window.removeEventListener("storage", syncOtherTab);
  }, []);

  const setLanguage = useCallback((nextLocale) => {
    const safeLocale = nextLocale === "ceb" ? "ceb" : "en";
    setLocale(safeLocale);
    try {
      window.localStorage.setItem(STORAGE_KEY, safeLocale);
    } catch {
      // Keep the language change active for this tab if browser storage is blocked.
    }
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(locale === "ceb" ? "en" : "ceb");
  }, [locale, setLanguage]);

  const t = useCallback((key, values = {}) => {
    const template = messages[locale]?.[key] ?? messages.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (placeholder, name) =>
      Object.hasOwn(values, name) ? String(values[name]) : placeholder
    );
  }, [locale]);

  const value = useMemo(() => ({ locale, setLanguage, toggleLanguage, t }), [locale, setLanguage, toggleLanguage, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside LocaleProvider");
  return context;
}
