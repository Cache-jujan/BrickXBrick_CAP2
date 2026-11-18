import { PESO_EXACT } from "../../utils/plainLanguage";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ProjectsTable.css";

/**
 * F11: contract and margin. Revenue is the signed contract (F2 contract page).
 *   Margin before labor = contract - approved spend to date
 *   Margin after labor  = margin before labor - planned labor from the approved BOM
 *   Cash position       = collected from the client - approved spend to date
 * Labor is not recorded as spend (expenses are receipts), so the BOM's planned
 * labor is shown instead of a guess. Materials still to be bought lower both
 * margins, so they are read next to Work done.
 * projects / totals: from GET /api/reports/summary (each has `contract`).
 * Reuses the breakdown table's styles (ProjectsTable.css); no new styling.
 */
export function ContractMargin({ projects, totals }) {
  const { t } = useLocale();
  const tc = totals.contract || { contractCount: 0, projectCount: projects.length };
  if (tc.contractCount === 0) {
    return <p className="reports-chart-note">{t("rep.contract_none")}</p>;
  }
  const single = projects.length === 1;
  return (
    <>
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th scope="col">{t("nav.project")}</th>
              <th scope="col" className="num">{t("rep.contract_amount")}</th>
              <th scope="col" className="num">{t("rep.collected")}</th>
              <th scope="col" className="num">{t("rep.margin_before_labor")}</th>
              <th scope="col" className="num">{t("rep.planned_labor")}</th>
              <th scope="col" className="num">{t("rep.margin_after_labor")}</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <Row key={p.projectId} name={p.name} c={p.contract} />
            ))}
          </tbody>
          {!single && (
            <tfoot>
              <Row name={t("rep.contract_total", { count: tc.contractCount, total: tc.projectCount })} c={tc} />
            </tfoot>
          )}
        </table>
      </div>
      <p className={"reports-chart-note" + (tc.cashPosition < 0 ? " report-table-variance-over" : "")}>
        {t("rep.cash_position", { amount: PESO_EXACT.format(tc.cashPosition) })}
        {tc.cashPosition < 0 ? ` ${t("rep.cash_financing")}` : ""}
        {tc.laborIncludedInPrices ? ` ${t("rep.labor_in_prices")}` : ""}
      </p>
    </>
  );
}

function Row({ name, c }) {
  const { t } = useLocale();
  if (!c || c.contractAmount === undefined) {
    return (
      <tr>
        <th scope="row">{name}</th>
        <td colSpan={5} className="report-table-sub">{t("rep.contract_missing")}</td>
      </tr>
    );
  }
  const money = (value) => (value === null || value === undefined ? "n/a" : PESO_EXACT.format(value));
  const neg = (value) => "num" + (typeof value === "number" && value < 0 ? " report-table-variance-over" : "");
  return (
    <tr>
      <th scope="row">{name}</th>
      <td className="num">{money(c.contractAmount)}</td>
      <td className="num">
        {money(c.collected)}
        {c.collectedPct !== null && c.collectedPct !== undefined && (
          <span className="report-table-sub">{t("rep.collected_pct", { pct: `${c.collectedPct.toFixed(1)}%` })}</span>
        )}
      </td>
      <td className={neg(c.marginBeforeLabor)}>{money(c.marginBeforeLabor)}</td>
      <td className="num">{c.laborIncludedInPrices && !c.budgetedLabor ? t("rep.labor_in_prices_short") : money(c.budgetedLabor)}</td>
      <td className={neg(c.marginAfterLabor)}>
        {money(c.marginAfterLabor)}
        {c.marginAfterLaborPct !== null && c.marginAfterLaborPct !== undefined && (
          <span className="report-table-sub">{t("rep.of_contract", { pct: `${c.marginAfterLaborPct.toFixed(1)}%` })}</span>
        )}
      </td>
    </tr>
  );
}
