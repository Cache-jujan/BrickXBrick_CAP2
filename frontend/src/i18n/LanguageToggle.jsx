import { SUPPORTED_LOCALES, useLocale } from "./LocaleProvider";
import "./LanguageToggle.css";

const SHORT = { en: "EN", ceb: "CEB", fil: "FIL" };
const NAME_KEY = { en: "language.english", ceb: "language.bisaya", fil: "language.filipino" };

// Segmented EN / CEB / FIL control. Each option is named in full for screen readers.
export function LanguageToggle() {
  const { locale, setLanguage, t } = useLocale();

  return (
    <div className="language-switch" role="radiogroup" aria-label={t("language.name")}>
      {SUPPORTED_LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          role="radio"
          aria-checked={locale === code}
          aria-label={t(NAME_KEY[code])}
          title={t(NAME_KEY[code])}
          className={`language-switch-option${locale === code ? " is-active" : ""}`}
          onClick={() => setLanguage(code)}
        >
          {SHORT[code]}
        </button>
      ))}
    </div>
  );
}
