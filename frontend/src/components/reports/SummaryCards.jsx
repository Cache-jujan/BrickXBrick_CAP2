import { PESO_EXACT } from "../../utils/plainLanguage";
import { signedPct, varianceWords } from "../../utils/variance";
import { useLocale } from "../../i18n/LocaleProvider";
import "./SummaryCards.css";

const pct = (value) => (value === null || value === undefined ? "n/a" : `${value.toFixed(1)}%`);
const clamp = (value) => (value === null || value === undefined ? 0 : Math.max(0, Math.min(100, value)));

/**
 * The four headline figures for everything that was selected.
 * totals: the `totals` object of GET /api/reports/summary.
 * Every figure here counts spend TO DATE (all approved spend up to the end
 * date): Net P&L is the budget left, and the cost variance under it is the same
 * amount with the sign flipped. This period's spend is the line under "Spent to date".
 */
export function SummaryCards({ totals, projectCount, watchGapPoints }) {
  const { t } = useLocale();
  const negative = totals.netPnL < 0;
  const used = totals.cumulativeUtilizationPct;
  const done = totals.progressPct;
  const watch = totals.health === "watch";
  return (
    <div className="summary-cards">
      <article className="summary-card">
        <h3>{t("rep.total_budget")}</h3>
        <p className="summary-card-value">{PESO_EXACT.format(totals.budget)}</p>
        <p className="summary-card-sub">{t("rep.across_n", { count: projectCount })}</p>
      </article>

      <article className="summary-card">
        <h3>{t("rep.spent_to_date")}</h3>
        <p className="summary-card-value">{PESO_EXACT.format(totals.cumulativeSpend)}</p>
        <p className="summary-card-sub">{t("rep.in_period_amount", { amount: PESO_EXACT.format(totals.periodSpend) })}</p>
      </article>

      <article className={"summary-card" + (negative ? " summary-card-negative" : "")}>
        <h3>{t("rep.net_pnl")}</h3>
        <p className="summary-card-value">{PESO_EXACT.format(totals.netPnL)}</p>
        <p className="summary-card-sub">
          {used === null || used === undefined
            ? t("rep.no_budget")
            : `${varianceWords(totals.varianceToDate, t)} · ${t("rep.variance_line", { pct: signedPct(totals.varianceToDatePct) })}`}
        </p>
      </article>

      <article className={"summary-card" + (watch ? " summary-card-watch" : "")}>
        <h3>{t("rep.work_done")}</h3>
        <p className="summary-card-value">{done === null || done === undefined ? t("rep.no_milestones") : pct(done)}</p>
        <span className="summary-card-pair" aria-hidden="true">
          <span className="summary-card-bar"><span className="summary-card-bar-fill summary-card-bar-used" style={{ width: `${clamp(used)}%` }} /></span>
          <span className="summary-card-bar"><span className="summary-card-bar-fill summary-card-bar-done" style={{ width: `${clamp(done)}%` }} /></span>
        </span>
        <p className="summary-card-sub">
          {t("rep.work_done_sub", { used: pct(used) })}
          {watch && <strong className="summary-card-watch-text"> · {t("rep.watch_rule", { max: watchGapPoints })}</strong>}
        </p>
      </article>
    </div>
  );
}
