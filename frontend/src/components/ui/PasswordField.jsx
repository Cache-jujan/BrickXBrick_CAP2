import { useState } from "react";
import { Field } from "./Field";
import { EyeIcon, EyeOffIcon } from "./icons";
import { useLocale } from "../../i18n/LocaleProvider";
import "./PasswordField.css";

/** A password box with its own show/hide eye. Other props go to the input. */
export function PasswordField({ label, error, ...inputProps }) {
  const { t } = useLocale();
  const [shown, setShown] = useState(false);
  return (
    <div className="pwf">
      <Field label={label} error={error} type={shown ? "text" : "password"} {...inputProps} />
      <button
        type="button"
        className="pwf-toggle"
        onClick={() => setShown((v) => !v)}
        aria-label={t(shown ? "auth.hide_field" : "auth.show_field", { field: String(label).toLowerCase() })}
        aria-pressed={shown}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
