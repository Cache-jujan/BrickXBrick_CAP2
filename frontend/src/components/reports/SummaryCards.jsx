import { PESO_EXACT } from "../../utils/plainLanguage";
import "./SummaryCards.css";

const pct = (value) => (value === null || value === undefined ? "n/a" : `${value.toFixed(2)}%`);

/**
 * The four headline figures for everything that was selected.
 * totals: the `totals` object of GET /api/reports/summary.
 * Net P&L is red when negative (spend above budget).
 */
export function SummaryCards({ totals, periodTo }) {
  const negative = totals.netPnL < 0;
  return (
    <div className="summary-cards">
      <article className="summary-card">
        <h3>Total budget</h3>
        <p className="summary-card-value">{PESO_EXACT.format(totals.budget)}</p>
      </article>

      <article className="summary-card">
        <h3>Spend in this period</h3>
        <p className="summary-card-value">{PESO_EXACT.format(totals.periodSpend)}</p>
        <p className="summary-card-sub">
          {PESO_EXACT.format(totals.cumulativeSpend)} in total up to {periodTo}
        </p>
      </article>

      <article className={"summary-card" + (negative ? " summary-card-negative" : "")}>
        <h3>Net P&amp;L</h3>
        <p className="summary-card-value">{PESO_EXACT.format(totals.netPnL)}</p>
        <p className="summary-card-sub">{negative ? "Over budget" : "Budget minus spend"}</p>
      </article>

      <article className={"summary-card" + (totals.overrun ? " summary-card-negative" : "")}>
        <h3>Budget used</h3>
        <p className="summary-card-value">{pct(totals.utilizationPct)}</p>
        <p className="summary-card-sub">
          {totals.cumulativeUtilizationPct === null ? "No budget set" : `${pct(totals.cumulativeUtilizationPct)} to date`}
        </p>
      </article>
    </div>
  );
}
