import { useLocale } from "../../i18n/LocaleProvider";
import "./Field.css";

/**
 * A labeled form field. Renders <textarea> if `as="textarea"`,
 * otherwise a standard <input>. `error` renders inline below the field.
 * `missing` tags a required box that still needs input (a small "Needed" pill by the label).
 */
export function Field({
  label,
  required,
  error,
  as = "input",
  className = "",
  prefix,
  missing = false,
  ...inputProps
}) {
  const { t } = useLocale();
  const Tag = as;
  const control = <Tag className={`field-control ${error ? "field-control-error" : ""} ${missing ? "field-control-missing" : ""}`} {...inputProps} />;
  return (
    <label className={`field ${className}`}>
      <span className="field-label">
        {label}
        {required && <span className="field-required"> *</span>}
        {missing && <span className="field-missing-tag">{t("gap.needed")}</span>}
      </span>
      {prefix ? (
        <span className="field-affix">
          <span className="field-prefix" aria-hidden="true">{prefix}</span>
          {control}
        </span>
      ) : control}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
