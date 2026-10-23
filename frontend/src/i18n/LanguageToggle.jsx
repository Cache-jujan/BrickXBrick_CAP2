import { useLocale } from "./LocaleProvider";
import "./LanguageToggle.css";

export function LanguageToggle({ compact = false }) {
  const { locale, toggleLanguage, t } = useLocale();
  const label = locale === "ceb" ? t("language.english_action") : t("language.translate");

  return (
    <button
      type="button"
      className={`language-toggle${compact ? " language-toggle-compact" : ""}`}
      onClick={toggleLanguage}
      aria-label={label}
      aria-pressed={locale === "ceb"}
      title={label}
    >
      <span aria-hidden="true">{locale === "ceb" ? "EN" : "CEB"}</span>
      <span>{label}</span>
    </button>
  );
}
