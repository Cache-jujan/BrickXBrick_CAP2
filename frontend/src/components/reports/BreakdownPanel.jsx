import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../ui/Button";
import { PESO_EXACT } from "../../utils/plainLanguage";
import { useLocale } from "../../i18n/LocaleProvider";
import { getReportBreakdown } from "../../api/reportsApi";
import { extractErrorMessage } from "../../api/client";
import "./ProjectsTable.css";
import "./BreakdownPanel.css";

const FORMAL = "Formal-Tax-Deductible";
const TABS = ["spend", "budget", "work"];
const cents = (n) => Math.round(Number(n) * 100);
const sum = (list) => list.reduce((t, x) => t + cents(x.amount), 0) / 100;
const pct = (value) => (value === null || value === undefined || !Number.isFinite(value) ? "n/a" : `${value.toFixed(1)}%`);

/**
 * F11 "View breakdown": a side panel that shows the rows behind a figure and
 * the formula with the real numbers, so the General Manager can check it.
 * filters: the filters the report on screen was GENERATED from (not the form).
 * tab: "spend" | "budget" | "work"; projectId: open on one project, or null.
 * The rows come from GET /api/reports/breakdown, which uses the same counting
 * rules as the summary, so they add up to the figure that was clicked.
 */
export function BreakdownPanel({ filters, tab: initialTab, projectId: initialProject, onClose }) {
  const { t } = useLocale();
  const [tab, setTab] = useState(initialTab || "spend");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [projectId, setProjectId] = useState(initialProject || "all");

  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    getReportBreakdown(filters)
      .then((result) => alive && setData(result))
      .catch((err) => alive && setError(extractErrorMessage(err)));
    return () => {
      alive = false;
    };
  }, [filters]);

  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const projects = useMemo(() => {
    if (!data) return [];
    return projectId === "all" ? data.projects : data.projects.filter((p) => p.projectId === projectId);
  }, [data, projectId]);

  return (
    <div className="bd-overlay" onClick={onClose}>
      <aside className="bd-panel" role="dialog" aria-modal="true" aria-label={t("bd.title")} onClick={(e) => e.stopPropagation()}>
        <header className="bd-head">
          <div>
            <h2 className="bd-title">{t("bd.title")}</h2>
            <p className="bd-sub">{t("bd.sub", { from: filters.from, to: filters.to })}</p>
          </div>
          <Button variant="ghost" onClick={onClose}>{t("bd.close")}</Button>
        </header>

        <div className="bd-controls">
          <div className="bd-tabs" role="tablist">
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={"bd-tab" + (tab === key ? " bd-tab-on" : "")}
                onClick={() => setTab(key)}
              >
                {t(`bd.tab_${key}`)}
              </button>
            ))}
          </div>
          {data && data.projects.length > 1 && (
            <select className="bd-select" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label={t("nav.project")}>
              <option value="all">{t("bd.all_projects")}</option>
              {data.projects.map((p) => (
                <option key={p.projectId} value={p.projectId}>{p.name}</option>
              ))}
            </select>
          )}
        </div>

        <p className="bd-note">{t("bd.open_hint")}</p>
        {error && <p className="bd-error">{error}</p>}
        {!data && !error && <p className="bd-note">{t("bd.loading")}</p>}
        {data && tab === "spend" && <SpendTab projects={projects} period={data.period} multi={data.projects.length > 1} />}
        {data && tab === "budget" && <BudgetTab projects={projects} />}
        {data && tab === "work" && <WorkTab projects={projects} asOf={data.asOf} />}
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

function SpendTab({ projects, period, multi }) {
  const { t } = useLocale();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [onlyPeriod, setOnlyPeriod] = useState(false);

  const all = projects.flatMap((p) => p.expenses.map((e) => ({ ...e, projectName: p.name, projectId: p.projectId })));
  const inPeriod = all.filter((e) => e.inPeriod);
  const formal = inPeriod.filter((e) => e.birValidationStatus === FORMAL);
  const informal = inPeriod.filter((e) => e.birValidationStatus !== FORMAL);
  const periodTotal = sum(inPeriod);
  const excluded = projects.flatMap((p) => p.excluded.map((x) => ({ ...x, projectName: p.name, projectId: p.projectId })));

  const needle = search.trim().toLowerCase();
  const shown = all.filter(
    (e) =>
      (!onlyPeriod || e.inPeriod) &&
      (type === "all" || (type === "formal" ? e.birValidationStatus === FORMAL : e.birValidationStatus !== FORMAL)) &&
      (!needle || (e.vendorName || "").toLowerCase().includes(needle) || (e.projectName || "").toLowerCase().includes(needle))
  );

  return (
    <div className="bd-body">
      <Formula label={t("rep.spent_to_date")}>
        {t("bd.spend_to_date_math", { n: all.length, to: period.to, amount: PESO_EXACT.format(sum(all)) })}
      </Formula>
      <Formula label={t("rep.spent_in_period")}>
        {t("bd.spend_period_math", { n: inPeriod.length, from: period.from, to: period.to, amount: PESO_EXACT.format(periodTotal) })}
      </Formula>
      <Formula label={t("bd.formal")}>
        {t("bd.formal_math", {
          n: formal.length,
          amount: PESO_EXACT.format(sum(formal)),
          pct: pct(periodTotal ? (sum(formal) / periodTotal) * 100 : null),
        })}
      </Formula>
      <Formula label={t("bd.informal")}>
        {t("bd.informal_math", { n: informal.length, amount: PESO_EXACT.format(sum(informal)) })}
      </Formula>

      <div className="bd-filters">
        <input
          className="bd-input"
          type="search"
          placeholder={t("bd.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t("bd.search")}
        />
        <select className="bd-select" value={type} onChange={(e) => setType(e.target.value)} aria-label={t("bd.receipt_type")}>
          <option value="all">{t("bd.type_all")}</option>
          <option value="formal">{t("bd.formal")}</option>
          <option value="informal">{t("bd.informal")}</option>
        </select>
        <label className="bd-check">
          <input type="checkbox" checked={onlyPeriod} onChange={(e) => setOnlyPeriod(e.target.checked)} />
          {t("bd.only_period")}
        </label>
      </div>

      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th scope="col">{t("bd.date")}</th>
              <th scope="col">{t("bd.vendor")}</th>
              {multi && <th scope="col">{t("nav.project")}</th>}
              <th scope="col">{t("bd.receipt_type")}</th>
              <th scope="col">{t("bd.in_period")}</th>
              <th scope="col" className="num">{t("bd.amount")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={multi ? 6 : 5} className="report-table-sub">{t("bd.no_rows")}</td>
              </tr>
            )}
            {shown.map((e) => (
              <tr key={e.expenseId}>
                <td>{e.receiptDate}</td>
                <td><Link to={`/expenses?focus=${e.expenseId}`}>{e.vendorName}</Link></td>
                {multi && <td><Link to={`/projects/${e.projectId}#expenses`}>{e.projectName}</Link></td>}
                <td>{e.birValidationStatus === FORMAL ? t("bd.formal") : t("bd.informal")}</td>
                <td>{e.inPeriod ? t("bd.yes") : t("bd.before_period")}</td>
                <td className="num">{PESO_EXACT.format(e.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={multi ? 5 : 4}>{t("bd.shown_total", { n: shown.length })}</th>
              <td className="num">{PESO_EXACT.format(sum(shown))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h3 className="bd-h3">{t("bd.not_counted")}</h3>
      {excluded.length === 0 ? (
        <p className="bd-note">{t("bd.none_excluded")}</p>
      ) : (
        <>
          <p className="bd-note">{t("bd.excluded_note", { n: excluded.length, amount: PESO_EXACT.format(sum(excluded)) })}</p>
          <ul className="bd-list">
            {excluded.map((x) => (
              <li key={x.expenseId}>
                {x.receiptDate} · <Link to={`/expenses?focus=${x.expenseId}`}>{x.vendorName}</Link>
                {multi ? ` · ${x.projectName}` : ""} · {PESO_EXACT.format(x.amount)} ·{" "}
                {x.status === "Pending" ? t("bd.pending") : x.status}
                {x.fraudFlagged ? ` · ${t("bd.flagged")}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function BudgetTab({ projects }) {
  const { t } = useLocale();
  return (
    <div className="bd-body">
      {projects.map((p) => {
        const spent = sum(p.expenses);
        const left = (cents(p.budget) - cents(spent)) / 100;
        const used = p.budget > 0 ? (spent / p.budget) * 100 : null;
        return (
          <section key={p.projectId} className="bd-block">
            <h3 className="bd-h3"><Link to={`/projects/${p.projectId}`}>{p.name}</Link></h3>
            <Formula label={t("rep.net_pnl")}>
              {PESO_EXACT.format(p.budget)} − {PESO_EXACT.format(spent)} = <strong className={left < 0 ? "bd-neg" : ""}>{PESO_EXACT.format(left)}</strong>
            </Formula>
            <Formula label={t("bd.budget_used")}>
              {PESO_EXACT.format(spent)} ÷ {PESO_EXACT.format(p.budget)} = <strong>{pct(used)}</strong>
            </Formula>
            <p className="bd-note">{t("bd.budget_note", { n: p.expenses.length })}</p>
          </section>
        );
      })}
    </div>
  );
}

function WorkTab({ projects, asOf }) {
  const { t } = useLocale();
  return (
    <div className="bd-body">
      {projects.map((p) => {
        const ms = p.milestones;
        const avg = ms.length ? ms.reduce((s, m) => s + m.completion, 0) / ms.length : null;
        const overdue = ms.filter((m) => m.overdue).length;
        return (
          <section key={p.projectId} className="bd-block">
            <h3 className="bd-h3"><Link to={`/projects/${p.projectId}#milestones`}>{p.name}</Link></h3>
            {ms.length === 0 ? (
              <p className="bd-note">{t("rep.no_milestones")}</p>
            ) : (
              <>
                <Formula label={t("rep.work_done")}>
                  ({ms.map((m) => `${m.completion}`).join(" + ")}) ÷ {ms.length} = <strong>{pct(avg)}</strong>
                </Formula>
                <p className="bd-note">
                  {t("bd.overdue_note", { n: overdue, date: asOf })}
                </p>
                <div className="report-table-wrap">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th scope="col">{t("bd.milestone")}</th>
                        <th scope="col">{t("bd.due")}</th>
                        <th scope="col" className="num">{t("bd.completion")}</th>
                        <th scope="col">{t("bd.state")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ms.map((m) => (
                        <tr key={`${m.name}-${m.dueDate}`} className={m.overdue ? "report-table-over" : ""}>
                          <td><Link to={`/projects/${p.projectId}#milestones`}>{m.name}</Link></td>
                          <td>{m.dueDate}</td>
                          <td className="num">{pct(m.completion)}</td>
                          <td>{m.completion >= 100 ? t("bd.done") : m.overdue ? t("bd.overdue") : t("bd.on_schedule")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        );
      })}
      {projects.length > 1 && <p className="bd-note">{t("bd.weighted_note")}</p>}
    </div>
  );
}

/** The small "View breakdown →" link placed under a figure. */
export function BreakdownLink({ onClick }) {
  const { t } = useLocale();
  return (
    <button type="button" className="bd-link" onClick={onClick}>
      {t("bd.view")} →
    </button>
  );
}
