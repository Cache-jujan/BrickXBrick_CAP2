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
  prefix,
  ...inputProps
}) {
  const Tag = as;
  const control = <Tag className={`field-control ${error ? "field-control-error" : ""}`} {...inputProps} />;
  return (
    <label className={`field ${className}`}>
      <span className="field-label">
        {label}
        {required && <span className="field-required"> *</span>}
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
