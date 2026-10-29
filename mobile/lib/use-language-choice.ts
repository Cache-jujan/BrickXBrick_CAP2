import { useRef } from "react";

import { confirmAction } from "@/lib/confirm";
import { useLocale, type AppLocale } from "@/lib/i18n-context";

// The languages offered, in the order they are listed. nameKey is the catalog
// key of the language's name; short is the small code shown beside it.
export const LANGUAGE_OPTIONS: { code: AppLocale; short: string; nameKey: string }[] = [
  { code: "en", short: "EN", nameKey: "language.english" },
  { code: "ceb", short: "CEB", nameKey: "language.bisaya" },
  { code: "fil", short: "FIL", nameKey: "language.filipino" },
];

// Picking a language asks first; nothing changes until it is confirmed.
// The Settings screen and the language popup both use this, so they behave the
// same: the same question, the same labels, and only one question at a time.
export function useLanguageChoice() {
  const { locale, setLanguage, t } = useLocale();
  // True while the question is on screen. A second tap meanwhile is ignored,
  // so two questions can never stack on top of each other.
  const asking = useRef(false);

  async function choose(code: AppLocale) {
    const option = LANGUAGE_OPTIONS.find((o) => o.code === code);
    if (!option || code === locale || asking.current) return;
    asking.current = true;
    try {
      const ok = await confirmAction({
        title: t("settings.confirm_language_title"),
        message: t("settings.confirm_language_body", { language: t(option.nameKey) }),
        confirmLabel: t("settings.confirm_yes"),
        cancelLabel: t("common.cancel"),
      });
      if (ok) setLanguage(code);
    } finally {
      asking.current = false;
    }
  }

  return { locale, options: LANGUAGE_OPTIONS, choose };
}
