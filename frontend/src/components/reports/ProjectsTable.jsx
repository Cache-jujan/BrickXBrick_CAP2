import { PESO_EXACT } from "../../utils/plainLanguage";
import { signedPct, varianceWords } from "../../utils/variance";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ProjectsTable.css";

const pct = (value) => (value === null || value === undefined ? "n/a" : `${value.toFixed(1)}%`);
const share = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(0)}%` : "n/a");

/**
 * One row per project with every figure of the report, and the totals.
 * projects / totals: from GET /api/reports/summary.
 * Net P&L (budget left), its cost variance and "Used to date" all count every
 * approved expense up to the end of the period, the same as the PDF; "Spend in
 * period" counts only the chosen dates. Work done is the average milestone
 * completion. Rows over budget turn red and rows to watch amber, and both say
 * so in words.
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
            <th scope="col" className="report-table-used">{t("rep.used_to_date")}</th>
            <th scope="col" className="report-table-used">{t("rep.work_done")}</th>
            <th scope="col" className="num">{t("rep.tax_deductible")}</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.projectId} className={p.overrun ? "report-table-over" : p.health === "watch" ? "report-table-watch" : ""}>
              <th scope="row">
                {p.name}
                {p.overrun && <span className="report-table-flag">{t("dashboard.over_budget")}</span>}
                {!p.overrun && p.health === "watch" && <span className="report-table-flag report-table-flag-watch">{t("rep.watch")}</span>}
              </th>
              <td className="num">{PESO_EXACT.format(p.budget)}</td>
              <td className="num">{PESO_EXACT.format(p.periodSpend)}</td>
              <td className="num">{PESO_EXACT.format(p.cumulativeSpend)}</td>
              <LeftCell amount={p.netPnL} variance={p.varianceToDate} pct={p.varianceToDatePct} />
              <td className="report-table-used"><UsedBar value={p.cumulativeUtilizationPct} over={p.overrun} /></td>
              <td className="report-table-used"><UsedBar value={p.progressPct} done /></td>
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
            <LeftCell amount={totals.netPnL} variance={totals.varianceToDate} pct={totals.varianceToDatePct} />
            <td className="report-table-used"><UsedBar value={totals.cumulativeUtilizationPct} over={totals.overrun} /></td>
            <td className="report-table-used"><UsedBar value={totals.progressPct} done /></td>
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

// Budget left (Net P&L): red when below zero, with the cost variance to date
// (spend to date minus budget) and the words under it (never colour alone).
function LeftCell({ amount, variance, pct }) {
  const { t } = useLocale();
  const over = amount < 0;
  return (
    <td className={"num" + (over ? " report-table-variance-over" : "")}>
      {PESO_EXACT.format(amount)}
      <span className="report-table-sub">
        {Number.isFinite(variance) ? `${varianceWords(variance, t)} · ${t("rep.variance_line", { pct: signedPct(pct) })}` : ""}
      </span>
    </td>
  );
}

// A share as a small bar and its figure. done: work done (teal), never "over".
function UsedBar({ value, over, done }) {
  const { t } = useLocale();
  const missing = value === null || value === undefined;
  const width = missing ? 0 : Math.min(100, value);
  return (
    <div className="rt-bar">
      <span className="rt-bar-track" aria-hidden="true">
        <span className={"rt-bar-fill" + (over ? " rt-bar-over" : "") + (done ? " rt-bar-done" : "")} style={{ width: `${width}%` }} />
      </span>
      <span className={"rt-bar-text" + (over ? " rt-bar-text-over" : "")}>{missing && done ? t("rep.no_milestones_short") : pct(value)}</span>
    </div>
  );
}
