import { PESO_EXACT } from "../../utils/plainLanguage";
import "./SummaryCards.css";

const pct = (value) => (value === null || value === undefined ? "n/a" : `${value.toFixed(1)}%`);

/**
 * The four headline figures for everything that was selected.
 * totals: the `totals` object of GET /api/reports/summary.
 * "Budget left" is red when negative (spend above budget).
 */
export function SummaryCards({ totals, periodTo }) {
  const negative = totals.netPnL < 0;
  const used = totals.cumulativeUtilizationPct;
  return (
    <div className="summary-cards">
      <article className="summary-card">
        <h3>Total budget</h3>
        <p className="summary-card-value">{PESO_EXACT.format(totals.budget)}</p>
        <p className="summary-card-sub">Across the projects you chose</p>
      </article>

      <article className="summary-card">
        <h3>Spend in this period</h3>
        <p className="summary-card-value">{PESO_EXACT.format(totals.periodSpend)}</p>
        <p className="summary-card-sub">
          {PESO_EXACT.format(totals.cumulativeSpend)} in total up to {periodTo}
        </p>
      </article>

      <article className={"summary-card" + (negative ? " summary-card-negative" : "")}>
        <h3>Budget left</h3>
        <p className="summary-card-value">{PESO_EXACT.format(totals.netPnL)}</p>
        <p className="summary-card-sub">{negative ? "Over budget" : "Budget minus this period's spend"}</p>
      </article>

      <article className={"summary-card" + (totals.overrun ? " summary-card-negative" : "")}>
        <h3>Budget used to date</h3>
        <p className="summary-card-value">{pct(used)}</p>
        <span className="summary-card-bar" aria-hidden="true">
          <span className="summary-card-bar-fill" style={{ width: `${used === null || used === undefined ? 0 : Math.min(100, used)}%` }} />
        </span>
        <p className="summary-card-sub">
          {used === null || used === undefined ? "No budget set" : `${pct(totals.utilizationPct)} used in this period`}
        </p>
      </article>
    </div>
  );
}
