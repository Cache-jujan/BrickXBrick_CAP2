import { useLocale } from "../../i18n/LocaleProvider";

/**
 * The optional tax fields (TIN, BIR permit, OR/SI number) folded away, so the form is shorter.
 * Closed by default; a small badge on the title says when the receipt reading already filled some in.
 */
export function TaxDetails({ open, onToggle, filled, children }) {
  const { t } = useLocale();
  return (
    <details className="xp-tax" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>
        {t("submit.tax_details")} <span className="xp-tax-optional">({t("submit.optional")})</span>
        {filled && <span className="xp-tax-filled">{t("submit.tax_filled")}</span>}
      </summary>
      <div className="submit-expense-fields">{children}</div>
    </details>
  );
}
