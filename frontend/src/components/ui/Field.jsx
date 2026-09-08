import "./Field.css";

/**
 * A labeled form field. Renders <textarea> if `as="textarea"`,
 * otherwise a standard <input>. `error` renders inline below the field.
 */
export function Field({
  label,
  required,
  error,
  as = "input",
  className = "",
  ...inputProps
}) {
  const Tag = as;
  return (
    <label className={`field ${className}`}>
      <span className="field-label">
        {label}
        {required && <span className="field-required"> *</span>}
      </span>
      <Tag className={`field-control ${error ? "field-control-error" : ""}`} {...inputProps} />
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
