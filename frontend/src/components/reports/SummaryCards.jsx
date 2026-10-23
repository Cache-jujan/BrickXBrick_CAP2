import { PESO_EXACT } from "../../utils/plainLanguage";
import { signedPct, signedPeso, varianceWords } from "../../utils/variance";
import "./SummaryCards.css";

const pct = (value) => (value === null || value === undefined ? "n/a" : `${value.toFixed(1)}%`);

/**
 * The four headline figures for everything that was selected.
 * totals: the `totals` object of GET /api/reports/summary.
 * Net P&L ("budget left") is the budget minus this period's spend; Cost variance
 * is spend to date minus budget. Both turn red when spend is above budget.
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
        <h3>Net P&amp;L</h3>
        <p className="summary-card-value">{PESO_EXACT.format(totals.netPnL)}</p>
        <p className="summary-card-sub">{negative ? "Over budget" : "Budget left after this period's spend"}</p>
      </article>

      <article className={"summary-card" + (totals.varianceToDate > 0 ? " summary-card-negative" : "")}>
        <h3>Cost variance</h3>
        <p className="summary-card-value">{signedPeso(totals.varianceToDate)}</p>
        <span className="summary-card-bar" aria-hidden="true">
          <span className="summary-card-bar-fill" style={{ width: `${used === null || used === undefined ? 0 : Math.min(100, used)}%` }} />
        </span>
        <p className="summary-card-sub">
          {used === null || used === undefined || !Number.isFinite(totals.varianceToDate)
            ? "No budget set"
            : `${varianceWords(totals.varianceToDate)} (${signedPct(totals.varianceToDatePct)}) · ${pct(used)} of the budget used to date`}
        </p>
      </article>
    </div>
  );
}
