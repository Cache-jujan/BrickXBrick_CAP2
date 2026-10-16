import { PESO_EXACT } from "../../utils/plainLanguage";
import "./BirTable.css";

/**
 * Spend backed by Formal-Tax-Deductible receipts, per project and in total.
 * projects / totals: from GET /api/reports/summary.
 */
export function BirTable({ projects, totals }) {
  return (
    <div className="bir-table-wrap">
      <table className="bir-table">
        <caption>
          Tax-deductible spend
          <span>Only receipts classed Formal-Tax-Deductible, within the chosen dates.</span>
        </caption>
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col" className="bir-table-num">Formal-Tax-Deductible</th>
            <th scope="col" className="bir-table-num">Share of period spend</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.projectId}>
              <th scope="row">{p.name}</th>
              <td className="bir-table-num">{PESO_EXACT.format(p.birDeductibleSpend)}</td>
              <td className="bir-table-num">{share(p.birDeductibleSpend, p.periodSpend)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="bir-table-num">{PESO_EXACT.format(totals.birDeductibleSpend)}</td>
            <td className="bir-table-num">{share(totals.birDeductibleSpend, totals.periodSpend)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function share(part, whole) {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "n/a";
}
