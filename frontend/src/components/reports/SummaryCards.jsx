import { PESO_EXACT } from "../../utils/plainLanguage";
import { signedPct, signedPeso, varianceWords } from "../../utils/variance";
import { useLocale } from "../../i18n/LocaleProvider";
import "./SummaryCards.css";

const pct = (value) => (value === null || value === undefined ? "n/a" : `${value.toFixed(1)}%`);

/**
 * The four headline figures for everything that was selected.
 * totals: the `totals` object of GET /api/reports/summary.
 * Net P&L ("budget left") is the budget minus this period's spend; Cost variance
 * is spend to date minus budget. Both turn red when spend is above budget.
 */
export function SummaryCards({ totals, periodTo }) {
  const { t } = useLocale();
  const negative = totals.netPnL < 0;
  const used = totals.cumulativeUtilizationPct;
  return (
    <div className="summary-cards">
      <article className="summary-card">
        <h3>{t("rep.total_budget")}</h3>
        <p className="summary-card-value">{PESO_EXACT.format(totals.budget)}</p>
        <p className="summary-card-sub">{t("rep.across")}</p>
      </article>

      <article className="summary-card">
        <h3>{t("rep.spend_period")}</h3>
        <p className="summary-card-value">{PESO_EXACT.format(totals.periodSpend)}</p>
        <p className="summary-card-sub">
          {t("rep.in_total_up_to", { amount: PESO_EXACT.format(totals.cumulativeSpend), date: periodTo })}
        </p>
      </article>

      <article className={"summary-card" + (negative ? " summary-card-negative" : "")}>
        <h3>{t("rep.net_pnl")}</h3>
        <p className="summary-card-value">{PESO_EXACT.format(totals.netPnL)}</p>
        <p className="summary-card-sub">{negative ? t("dashboard.over_budget") : t("rep.budget_left")}</p>
      </article>

      <article className={"summary-card" + (totals.varianceToDate > 0 ? " summary-card-negative" : "")}>
        <h3>{t("rep.cost_variance")}</h3>
        <p className="summary-card-value">{signedPeso(totals.varianceToDate)}</p>
        <span className="summary-card-bar" aria-hidden="true">
          <span className="summary-card-bar-fill" style={{ width: `${used === null || used === undefined ? 0 : Math.min(100, used)}%` }} />
        </span>
        <p className="summary-card-sub">
          {used === null || used === undefined || !Number.isFinite(totals.varianceToDate)
            ? t("rep.no_budget")
            : t("rep.variance_summary", { words: varianceWords(totals.varianceToDate, t), pct: signedPct(totals.varianceToDatePct), used: pct(used) })}
        </p>
      </article>
    </div>
  );
}
