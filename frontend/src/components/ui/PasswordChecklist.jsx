import { checkPassword } from "../../utils/passwordRules";
import { useLocale } from "../../i18n/LocaleProvider";
import "./PasswordChecklist.css";

/** The password rules with a tick beside each one the typed password already meets. */
export function PasswordChecklist({ password }) {
  const { t } = useLocale();
  return (
    <div className="pw-checklist">
      <p className="pw-checklist-title">{t("pw.requirements")}</p>
      <ul>
        {checkPassword(password).map((rule) => (
          <li key={rule.id} className={rule.ok ? "pw-rule pw-rule-ok" : "pw-rule"}>
            <span className="pw-rule-mark" aria-hidden="true">{rule.ok ? "✓" : "•"}</span>
            <span>{t(rule.labelKey)}</span>
            <span className="sr-only">{rule.ok ? t("pw.met") : t("pw.not_met")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
