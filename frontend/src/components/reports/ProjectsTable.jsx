import { PESO_EXACT } from "../../utils/plainLanguage";
import { signedPct, signedPeso, varianceWords } from "../../utils/variance";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ProjectsTable.css";

const pct = (value) => (value === null || value === undefined ? "n/a" : `${value.toFixed(1)}%`);
const share = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(0)}%` : "n/a");

/**
 * One row per project with every figure of the report, and the totals.
 * projects / totals: from GET /api/reports/summary.
 * "Net P&L" is the budget minus the spend of THIS period (the same figure the
 * PDF calls Budget left); "Cost variance" is spend to date minus budget, and
 * "Used to date" counts everything up to the end of the period. Rows over
 * budget turn red and say so in words.
 */
export function ProjectsTable({ projects, totals }) {
  const { t } = useLocale();
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            <th scope="col">{t("nav.project")}</th>
            <th scope="col" className="num">{t("projects.budget")}</th>
            <th scope="col" className="num">{t("rep.spend_in_period")}</th>
            <th scope="col" className="num">{t("rep.spend_to_date")}</th>
            <th scope="col" className="num">{t("rep.net_pnl")}</th>
            <th scope="col" className="num">{t("rep.cost_variance")}</th>
            <th scope="col" className="report-table-used">{t("rep.used_to_date")}</th>
            <th scope="col" className="num">{t("rep.tax_deductible")}</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.projectId} className={p.overrun ? "report-table-over" : ""}>
              <th scope="row">
                {p.name}
                {p.overrun && <span className="report-table-flag">{t("dashboard.over_budget")}</span>}
              </th>
              <td className="num">{PESO_EXACT.format(p.budget)}</td>
              <td className="num">{PESO_EXACT.format(p.periodSpend)}</td>
              <td className="num">{PESO_EXACT.format(p.cumulativeSpend)}</td>
              <td className="num">{PESO_EXACT.format(p.netPnL)}</td>
              <VarianceCell amount={p.varianceToDate} pct={p.varianceToDatePct} />
              <td className="report-table-used"><UsedBar value={p.cumulativeUtilizationPct} over={p.overrun} /></td>
              <td className="num">
                {PESO_EXACT.format(p.birDeductibleSpend)}
                <span className="report-table-sub">{t("rep.of_period", { pct: share(p.birDeductibleSpend, p.periodSpend) })}</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{t("pd.total")}</th>
            <td className="num">{PESO_EXACT.format(totals.budget)}</td>
            <td className="num">{PESO_EXACT.format(totals.periodSpend)}</td>
            <td className="num">{PESO_EXACT.format(totals.cumulativeSpend)}</td>
            <td className="num">{PESO_EXACT.format(totals.netPnL)}</td>
            <VarianceCell amount={totals.varianceToDate} pct={totals.varianceToDatePct} />
            <td className="report-table-used"><UsedBar value={totals.cumulativeUtilizationPct} over={totals.overrun} /></td>
            <td className="num">
              {PESO_EXACT.format(totals.birDeductibleSpend)}
              <span className="report-table-sub">{t("rep.of_period", { pct: share(totals.birDeductibleSpend, totals.periodSpend) })}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// Spend to date minus budget: signed, red when over, with the share of the
// budget and the words under it (never colour alone).
function VarianceCell({ amount, pct }) {
  const { t } = useLocale();
  const over = amount > 0;
  return (
    <td className={"num" + (over ? " report-table-variance-over" : "")}>
      {signedPeso(amount)}
      <span className="report-table-sub">{Number.isFinite(amount) ? `${varianceWords(amount, t)} (${signedPct(pct)})` : ""}</span>
    </td>
  );
}

function UsedBar({ value, over }) {
  const width = value === null || value === undefined ? 0 : Math.min(100, value);
  return (
    <div className="rt-bar">
      <span className="rt-bar-track" aria-hidden="true">
        <span className={"rt-bar-fill" + (over ? " rt-bar-over" : "")} style={{ width: `${width}%` }} />
      </span>
      <span className={"rt-bar-text" + (over ? " rt-bar-text-over" : "")}>{pct(value)}</span>
    </div>
  );
}
