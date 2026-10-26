import { SUPPORTED_LOCALES, useLocale } from "./LocaleProvider";
import "./LanguageToggle.css";

const SHORT = { en: "EN", ceb: "CEB", fil: "FIL" };
// A language is shown in its own name, whatever language the page is in.
const OWN_NAME = { en: "English", ceb: "Bisaya", fil: "Filipino" };
const NAME_KEY = { en: "language.english", ceb: "language.bisaya", fil: "language.filipino" };

// Language switch. Each option is named in full for screen readers.
//   segmented (default): the EN / CEB / FIL box
//   menu:   a titled row of three buttons, for inside the account dropdown
//   inline: plain text links, for the footer of the sign-in card
export function LanguageToggle({ variant = "segmented" }) {
  const { locale, setLanguage, t } = useLocale();

  function option(code, className, label) {
    return (
      <button
        key={code}
        type="button"
        role="radio"
        aria-checked={locale === code}
        aria-label={t(NAME_KEY[code])}
        title={t(NAME_KEY[code])}
        className={`${className}${locale === code ? " is-active" : ""}`}
        onClick={() => setLanguage(code)}
      >
        {label}
      </button>
    );
  }

  if (variant === "segmented") {
    return (
      <div className="language-switch" role="radiogroup" aria-label={t("language.name")}>
        {SUPPORTED_LOCALES.map((code) => option(code, "language-switch-option", SHORT[code]))}
      </div>
    );
  }

  return (
    <div className={`language-${variant}`} role="radiogroup" aria-label={t("language.name")}>
      {variant === "menu" && <span className="language-menu-title">{t("language.name")}</span>}
      <div className={variant === "menu" ? "language-menu-options" : "language-inline-options"}>
        {SUPPORTED_LOCALES.map((code) => option(code, "language-link", OWN_NAME[code]))}
      </div>
    </div>
  );
}
