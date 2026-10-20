import { PESO_EXACT } from "../../utils/plainLanguage";
import "./ProjectsTable.css";

const pct = (value) => (value === null || value === undefined ? "n/a" : `${value.toFixed(1)}%`);
const share = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(0)}%` : "n/a");

/**
 * One row per project with every figure of the report, and the totals.
 * projects / totals: from GET /api/reports/summary.
 * "Budget left" is the budget minus the spend of THIS period (the same figure
 * the PDF calls Budget left); "Used to date" counts everything up to the end
 * of the period. Rows over budget turn red and say so in words.
 */
export function ProjectsTable({ projects, totals }) {
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col" className="num">Budget</th>
            <th scope="col" className="num">Spend in period</th>
            <th scope="col" className="num">Spend to date</th>
            <th scope="col" className="num">Budget left</th>
            <th scope="col" className="report-table-used">Used to date</th>
            <th scope="col" className="num">Tax-deductible</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.projectId} className={p.overrun ? "report-table-over" : ""}>
              <th scope="row">
                {p.name}
                {p.overrun && <span className="report-table-flag">Over budget</span>}
              </th>
              <td className="num">{PESO_EXACT.format(p.budget)}</td>
              <td className="num">{PESO_EXACT.format(p.periodSpend)}</td>
              <td className="num">{PESO_EXACT.format(p.cumulativeSpend)}</td>
              <td className="num">{PESO_EXACT.format(p.netPnL)}</td>
              <td className="report-table-used"><UsedBar value={p.cumulativeUtilizationPct} over={p.overrun} /></td>
              <td className="num">
                {PESO_EXACT.format(p.birDeductibleSpend)}
                <span className="report-table-sub">{share(p.birDeductibleSpend, p.periodSpend)} of period spend</span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="num">{PESO_EXACT.format(totals.budget)}</td>
            <td className="num">{PESO_EXACT.format(totals.periodSpend)}</td>
            <td className="num">{PESO_EXACT.format(totals.cumulativeSpend)}</td>
            <td className="num">{PESO_EXACT.format(totals.netPnL)}</td>
            <td className="report-table-used"><UsedBar value={totals.cumulativeUtilizationPct} over={totals.overrun} /></td>
            <td className="num">
              {PESO_EXACT.format(totals.birDeductibleSpend)}
              <span className="report-table-sub">{share(totals.birDeductibleSpend, totals.periodSpend)} of period spend</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
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
