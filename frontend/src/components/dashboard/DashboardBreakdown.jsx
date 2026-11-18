import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { PESO_EXACT } from "../../utils/plainLanguage";
import { useLocale } from "../../i18n/LocaleProvider";
import "../reports/ProjectsTable.css";
import "../reports/BreakdownPanel.css";

const VIEWS = ["projects", "budget", "spend"];
const cents = (n) => Math.round(Number(n || 0) * 100);
const pesos = (c) => c / 100;
const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "n/a");

/**
 * Dashboard "View breakdown": opened by clicking the Active projects, Open
 * budget or Approved spending card. It is built from the SAME lists the cards
 * are computed from (DashboardPage passes them in), so its totals always match
 * the cards. Every project and expense links to its own page, so the General
 * Manager can go from "why is this number so" to the record that explains it.
 *
 * view:            "projects" | "budget" | "spend"
 * openProjects:    Draft + Active projects (already scoped to the user)
 * approvedByProject: { [projectid]: approved peso total }
 * approvedExpenses:  approved expenses of the open projects
 * projectNames:    { [projectid]: name }
 */
export function DashboardBreakdown({ view, openProjects, approvedByProject, approvedExpenses, projectNames, onView, onClose }) {
  const { t } = useLocale();

  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const active = openProjects.filter((p) => p.status === "Active");
  const drafts = openProjects.filter((p) => p.status === "Draft");
  const budgetCents = openProjects.reduce((s, p) => s + cents(p.budget), 0);
  const spentCents = approvedExpenses.reduce((s, e) => s + cents(e.amount), 0);

  return (
    <div className="bd-overlay" onClick={onClose}>
      <aside className="bd-panel" role="dialog" aria-modal="true" aria-label={t("bd.title")} onClick={(e) => e.stopPropagation()}>
        <header className="bd-head">
          <div>
            <h2 className="bd-title">{t("bd.title")}</h2>
            <p className="bd-sub">{t("dbd.sub")}</p>
          </div>
          <Button variant="ghost" onClick={onClose}>{t("bd.close")}</Button>
        </header>

        <div className="bd-controls">
          <div className="bd-tabs" role="tablist">
            {VIEWS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                className={"bd-tab" + (view === key ? " bd-tab-on" : "")}
                onClick={() => onView(key)}
              >
                {t(`dbd.tab_${key}`)}
              </button>
            ))}
          </div>
        </div>
        <p className="bd-note">{t("bd.open_hint")}</p>

        {view === "projects" && (
          <div className="bd-body">
            <Formula label={t("dashboard.active_projects")}>
              {t("dbd.projects_math", { active: active.length, draft: drafts.length })}
            </Formula>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">{t("nav.project")}</th>
                    <th scope="col">{t("dashboard.status")}</th>
                    <th scope="col" className="num">{t("rep.work_done")}</th>
                    <th scope="col">{t("dbd.milestones")}</th>
                  </tr>
                </thead>
                <tbody>
                  {openProjects.length === 0 && (
                    <tr><td colSpan={4} className="report-table-sub">{t("dbd.no_projects")}</td></tr>
                  )}
                  {openProjects.map((p) => (
                    <tr key={p.projectid}>
                      <th scope="row"><Link to={`/projects/${p.projectid}`}>{p.name}</Link></th>
                      <td><Badge status={p.status} /></td>
                      <td className="num">{`${Number(p.progress || 0).toFixed(1)}%`}</td>
                      <td><Link to={`/projects/${p.projectid}#milestones`}>{t("dbd.open_milestones")} →</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="bd-note">{t("dbd.work_note")}</p>
          </div>
        )}

        {view === "budget" && (
          <div className="bd-body">
            <Formula label={t("dashboard.open_budget")}>
              {t("dbd.budget_math", { n: openProjects.length, amount: PESO_EXACT.format(pesos(budgetCents)) })}
            </Formula>
            <Formula label={t("dashboard.approved_spending")}>
              {PESO_EXACT.format(pesos(spentCents))} ÷ {PESO_EXACT.format(pesos(budgetCents))} = <strong>{pct(spentCents, budgetCents)}</strong>
            </Formula>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">{t("nav.project")}</th>
                    <th scope="col">{t("dashboard.status")}</th>
                    <th scope="col" className="num">{t("dbd.budget")}</th>
                    <th scope="col" className="num">{t("dbd.approved")}</th>
                    <th scope="col" className="num">{t("bd.budget_used")}</th>
                  </tr>
                </thead>
                <tbody>
                  {openProjects.map((p) => {
                    const b = cents(p.budget);
                    const s = cents(approvedByProject[p.projectid]);
                    return (
                      <tr key={p.projectid} className={s > b ? "report-table-over" : ""}>
                        <th scope="row"><Link to={`/projects/${p.projectid}`}>{p.name}</Link></th>
                        <td><Badge status={p.status} /></td>
                        <td className="num">{PESO_EXACT.format(pesos(b))}</td>
                        <td className="num">{PESO_EXACT.format(pesos(s))}</td>
                        <td className="num">{pct(s, b)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2}>{t("dbd.total")}</th>
                    <td className="num">{PESO_EXACT.format(pesos(budgetCents))}</td>
                    <td className="num">{PESO_EXACT.format(pesos(spentCents))}</td>
                    <td className="num">{pct(spentCents, budgetCents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="bd-note">{t("dbd.rounding_note")}</p>
          </div>
        )}

        {view === "spend" && (
          <div className="bd-body">
            <Formula label={t("dashboard.approved_spending")}>
              {t("dbd.spend_math", { n: approvedExpenses.length, amount: PESO_EXACT.format(pesos(spentCents)) })}
            </Formula>
            <div className="report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    <th scope="col">{t("bd.date")}</th>
                    <th scope="col">{t("bd.vendor")}</th>
                    <th scope="col">{t("nav.project")}</th>
                    <th scope="col" className="num">{t("bd.amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {approvedExpenses.length === 0 && (
                    <tr><td colSpan={4} className="report-table-sub">{t("bd.no_rows")}</td></tr>
                  )}
                  {[...approvedExpenses]
                    .sort((a, b) => String(b.receiptdate || "").localeCompare(String(a.receiptdate || "")))
                    .map((e) => (
                      <tr key={e.expenseid}>
                        <td>{e.receiptdate ? String(e.receiptdate).slice(0, 10) : "—"}</td>
                        <td><Link to={`/expenses?focus=${e.expenseid}`}>{e.vendorname || "—"}</Link></td>
                        <td><Link to={`/projects/${e.projectid}#expenses`}>{projectNames[e.projectid] || t("nav.project")}</Link></td>
                        <td className="num">{PESO_EXACT.format(e.amount)}</td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={3}>{t("bd.shown_total", { n: approvedExpenses.length })}</th>
                    <td className="num">{PESO_EXACT.format(pesos(spentCents))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="bd-note">{t("dbd.rounding_note")}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function Formula({ label, children }) {
  return (
    <div className="bd-formula">
      <span className="bd-formula-label">{label}</span>
      <span className="bd-formula-math">{children}</span>
    </div>
  );
}
