import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { listProjects } from "../../api/projectsApi";
import { listExpenses } from "../../api/expensesApi";
import { listTamperAlerts, getBlockchainSummary } from "../../api/blockchainApi";
import { listPendingTickets } from "../../api/ticketsApi";
import { listProgressSubmissions } from "../../api/taskProgressApi";
import { getAttentionMilestones } from "../../api/milestonesApi";
import { extractErrorMessage } from "../../api/client";
import { Banner } from "../../components/ui/Banner";
import { Badge } from "../../components/ui/Badge";
import { ProgressBar } from "../../components/milestones/ProgressBar";
import { SpendChart } from "../../components/dashboard/SpendChart";
import { useLocale } from "../../i18n/LocaleProvider";
import "./DashboardPage.css";

const PESO = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});
const MONTH = new Intl.DateTimeFormat("en-PH", { month: "short", year: "numeric" });

// Per the Process spec: the web dashboard is for General Manager and
// Project Manager (plus System Administrator for account management).
// Site Manager and Purchaser are mobile-only roles — see /mobile app.
const WEB_ROLES = ["General Manager", "Project Manager"];

const RANGES = [3, 6, 12];

export function DashboardPage() {
  const { user } = useAuth();

  // Admin has no dashboard of its own — its only web job is account
  // management, so send it straight to User Accounts.
  if (user.role === "System Administrator") {
    return <Navigate to="/admin/users" replace />;
  }
  if (WEB_ROLES.includes(user.role)) {
    return <ProjectsOverview role={user.role} name={user.name} userId={user.id} />;
  }
  // Site Manager and Purchaser have no web app — they're walled at the app
  // entry (AppShell in App.jsx) and never reach a dashboard. This is just a
  // defensive fallback.
  return <Navigate to="/" replace />;
}

function greetingFor(date, t) {
  const hour = date.getHours();
  if (hour < 12) return t("dashboard.morning");
  if (hour < 18) return t("dashboard.afternoon");
  return t("dashboard.evening");
}

// "5 minutes ago", "3 hours ago", "2 days ago". Never in the future. `t` is from useLocale().
function timeAgo(value, t, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60000));
  if (minutes < 1) return t("time.just_now");
  if (minutes < 60) return t("time.min_ago", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? t("time.hour_one") : t("time.hour_other", { count: hours });
  const days = Math.round(hours / 24);
  return days === 1 ? t("time.day_one") : t("time.day_other", { count: days });
}

// One entry per calendar month, oldest first, ending with the current month.
// Spending is bucketed by the receipt date (the day it was really bought),
// and `cumulative` starts from everything approved before the first month.
// `monthLabel(date)` formats the axis label; it defaults to the English one so the helper stays usable on its own.
export function buildMonthlySeries(approved, openBudget, monthsBack, now = new Date(), monthLabel = (date) => MONTH.format(date)) {
  const keyOf = (d) => d.getFullYear() * 12 + d.getMonth();
  const dateOf = (e) => new Date(e.receiptdate || e.submittedat);
  const startKey = keyOf(now) - (monthsBack - 1);

  let running = approved
    .filter((e) => keyOf(dateOf(e)) < startKey)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const months = [];
  for (let i = 0; i < monthsBack; i += 1) {
    const key = startKey + i;
    const spend = approved
      .filter((e) => keyOf(dateOf(e)) === key)
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);
    running += spend;
    months.push({
      label: monthLabel(new Date(Math.floor(key / 12), key % 12, 1)),
      spend,
      cumulative: running,
      remaining: openBudget > 0 ? openBudget - running : null,
    });
  }
  return months;
}

function ProjectsOverview({ role, name, userId }) {
  const { t, tv, formatDate } = useLocale();
  const canCreate = role === "General Manager";
  const canSeeAlerts = role === "General Manager"; // matches backend requireRole on /alerts
  const isPM = role === "Project Manager";

  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState("");

  const [expenses, setExpenses] = useState([]);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [expensesError, setExpensesError] = useState("");

  const [alertCount, setAlertCount] = useState(null);
  const [confirmedCount, setConfirmedCount] = useState(null);
  const [pendingChainCount, setPendingChainCount] = useState(null);
  const [tamperedCount, setTamperedCount] = useState(null);

  const [range, setRange] = useState(6);

  // PM "Needs your attention": tickets waiting to be assigned, progress
  // submissions waiting to be reviewed, and milestones that are At Risk /
  // Overdue. Each comes from a PM-scoped endpoint (backend filters by the
  // PM's own projects), so there's nothing to re-scope on the client.
  const [attnTickets, setAttnTickets] = useState([]);
  const [attnReviews, setAttnReviews] = useState([]);
  const [attnMilestones, setAttnMilestones] = useState([]);
  const [attnLoading, setAttnLoading] = useState(isPM);

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((data) => { if (!cancelled) setProjects(data); })
      .catch((err) => { if (!cancelled) setProjectsError(extractErrorMessage(err, t("errors.load_projects"))); })
      .finally(() => { if (!cancelled) setProjectsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; a language change must not refetch
  }, []);

  useEffect(() => {
    let cancelled = false;
    listExpenses()
      .then((data) => { if (!cancelled) setExpenses(data); })
      .catch((err) => { if (!cancelled) setExpensesError(extractErrorMessage(err, t("errors.load_expenses"))); })
      .finally(() => { if (!cancelled) setExpensesLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; a language change must not refetch
  }, []);

  useEffect(() => {
    if (!canSeeAlerts) return;
    let cancelled = false;
    listTamperAlerts()
      .then((data) => { if (!cancelled) setAlertCount(data.length); })
      .catch(() => { if (!cancelled) setAlertCount(null); });
    return () => { cancelled = true; };
  }, [canSeeAlerts]);

  useEffect(() => {
    if (!isPM) return undefined;
    let cancelled = false;
    setAttnLoading(true);
    Promise.all([
      listPendingTickets().catch(() => []),
      listProgressSubmissions("Pending Review").catch(() => []),
      getAttentionMilestones().catch(() => []),
    ])
      .then(([tickets, reviews, milestones]) => {
        if (cancelled) return;
        setAttnTickets(tickets);
        setAttnReviews(reviews);
        setAttnMilestones(milestones);
      })
      .finally(() => { if (!cancelled) setAttnLoading(false); });
    return () => { cancelled = true; };
  }, [isPM]);

  useEffect(() => {
    if (!canSeeAlerts) return;
    let cancelled = false;
    getBlockchainSummary()
      .then((data) => {
        if (!cancelled) {
          setConfirmedCount(data.confirmedCount);
          setPendingChainCount(data.pendingCount);
          setTamperedCount(data.tamperedCount);
        }
      })
      .catch(() => { if (!cancelled) setConfirmedCount(null); });
    return () => { cancelled = true; };
  }, [canSeeAlerts]);

  // A Project Manager only manages the projects assigned to them — scope
  // "their" numbers to that, mirroring assertProjectAccess on the backend.
  // A General Manager sees everything, same as GET /api/projects broadcast.
  const scopedProjects = role === "Project Manager"
    ? projects.filter((p) => p.projectmanagerid === userId)
    : projects;

  const projectNames = Object.fromEntries(projects.map((p) => [p.projectid, p.name]));
  const openProjects = scopedProjects.filter((p) => p.status === "Draft" || p.status === "Active");
  const activeCount = scopedProjects.filter((p) => p.status === "Active").length;
  const draftCount = scopedProjects.filter((p) => p.status === "Draft").length;
  const openBudget = openProjects.reduce((sum, p) => sum + Number(p.budget || 0), 0);

  const approved = expenses.filter((e) => e.status === "Approved");
  const pending = expenses.filter((e) => e.status === "Pending");
  const approvedByProject = approved.reduce((acc, e) => {
    acc[e.projectid] = (acc[e.projectid] || 0) + Number(e.amount || 0);
    return acc;
  }, {});
  const openIds = new Set(openProjects.map((p) => p.projectid));
  const openApprovedExpenses = approved.filter((e) => openIds.has(e.projectid));
  const openApproved = openProjects.reduce((sum, p) => sum + (approvedByProject[p.projectid] || 0), 0);
  const pendingAmount = pending.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const usedPct = openBudget > 0 ? Math.round((openApproved / openBudget) * 100) : 0;

  const months = useMemo(
    () => buildMonthlySeries(openApprovedExpenses, openBudget, range, new Date(), (date) => formatDate(date, { month: "short", year: "numeric" })),
    // openApprovedExpenses is rebuilt each render; these change only when the data or language does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenses, projects, range, formatDate]
  );

  // Open projects, most budget used first, so overruns are at the top.
  const statusRows = openProjects
    .map((p) => {
      const budget = Number(p.budget || 0);
      const spent = approvedByProject[p.projectid] || 0;
      const pct = budget > 0 ? (spent / budget) * 100 : 0;
      const pastEnd = p.status === "Active" && p.enddate && new Date(p.enddate) < new Date();
      return {
        ...p,
        pct,
        overBudget: pct > 100,
        pastEnd,
        // Overall completion = mean of milestone completion %, from the list
        // query's progress subquery (projects.js GET /).
        progressPct: Math.round(Number(p.progress || 0)),
      };
    })
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);

  const recentExpenses = [...expenses]
    .sort((a, b) => new Date(b.submittedat) - new Date(a.submittedat))
    .slice(0, 5);

  // Latest integrity checks, newest first (F12 keeps lastintegritycheckat).
  const recentChecks = expenses
    .filter((e) => e.lastintegritycheckat)
    .sort((a, b) => new Date(b.lastintegritycheckat) - new Date(a.lastintegritycheckat))
    .slice(0, 4);

  const dataError = projectsError || expensesError;
  const now = new Date();
  const today = formatDate(now, { month: "long", day: "numeric", year: "numeric" });
  const firstName = name.split(" ")[0];

  return (
    <div className="dashboard">
      <section className="dash-hero" aria-label={t("dashboard.welcome")}>
        <div className="dash-hero-text">
          <h1>{greetingFor(now, t)}, {firstName}</h1>
          <p>
            {role === "General Manager"
              ? t("dashboard.gm_intro")
              : t("dashboard.pm_intro")}
          </p>
        </div>
        <div className="dash-hero-side">
          <span className="dash-hero-date"><CalendarIcon />{today}</span>
          {canCreate && <Link to="/projects/new" className="btn btn-primary">{t("dashboard.create_project")}</Link>}
        </div>
        <SkylineArt />
      </section>

      {dataError && <Banner tone="error" title={dataError} />}

      <section className="dash-kpis" aria-label={t("dashboard.summary")}>
        <Kpi
          icon={<LayersIcon />}
          label={t("dashboard.active_projects")}
          value={projectsLoading ? "—" : activeCount}
          note={projectsLoading ? null : t("dashboard.in_draft", { count: draftCount })}
        />
        <Kpi
          icon={<PesoIcon />}
          label={t("dashboard.open_budget")}
          value={projectsLoading ? "—" : PESO.format(openBudget)}
          note={t("dashboard.draft_active")}
        />
        <Kpi
          icon={<WalletIcon />}
          label={t("dashboard.approved_spending")}
          value={expensesLoading ? "—" : PESO.format(openApproved)}
          note={expensesLoading || !openBudget ? null : t("dashboard.open_budget_pct", { percent: usedPct })}
        />
        <Kpi
          icon={<ClipboardIcon />}
          label={t("dashboard.pending_approvals")}
          value={expensesLoading ? "—" : pending.length}
          note={expensesLoading || !pending.length ? t("dashboard.nothing_pending") : t("dashboard.waiting_amount", { amount: PESO.format(pendingAmount) })}
          to={pending.length ? "/expenses" : null}
          emphasis={pending.length > 0}
        />
      </section>

      <div className="dash-main">
        <div className="dash-col">
          <section className="dash-panel">
            <header className="dash-panel-head">
              <h2>{t("dashboard.financial_overview")}</h2>
              <label className="dash-range">
                <span className="sr-only">{t("dashboard.period")}</span>
                <select value={range} onChange={(e) => setRange(Number(e.target.value))}>
                  {RANGES.map((r) => <option key={r} value={r}>{t("dashboard.last_months", { count: r })}</option>)}
                </select>
              </label>
            </header>
            {expensesLoading || projectsLoading ? (
              <p className="dashboard-loading">{t("dashboard.loading")}</p>
            ) : openApprovedExpenses.length === 0 && openBudget === 0 ? (
              <p className="dash-empty">{t("dashboard.no_approved_spending")}</p>
            ) : (
              <SpendChart months={months} />
            )}
            <p className="dash-footnote">
              {t("dashboard.chart_note")}
            </p>
          </section>

          <section className="dash-panel">
            <header className="dash-panel-head">
              <h2>{t("dashboard.recent_expenses")}</h2>
              <Link to="/expenses" className="dash-link">{t("dashboard.view_all")}</Link>
            </header>
            {!expensesError && expensesLoading && <p className="dashboard-loading">{t("dashboard.loading_expenses")}</p>}
            {!expensesError && !expensesLoading && recentExpenses.length === 0 && (
              <p className="dash-empty">{t("dashboard.no_expenses")}</p>
            )}
            {!expensesError && !expensesLoading && recentExpenses.length > 0 && (
              <div className="table-scroll">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>{t("dashboard.vendor")}</th>
                      <th>{t("nav.project")}</th>
                      <th>{t("dashboard.category")}</th>
                      <th className="num">{t("dashboard.amount")}</th>
                      <th>{t("dashboard.status")}</th>
                      <th>{t("dashboard.date")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentExpenses.map((e) => (
                      <tr key={e.expenseid}>
                        <td className="dash-project-plain">{e.vendorname}</td>
                        <td>{projectNames[e.projectid] || t("nav.project")}</td>
                        <td>{tv("category", e.category)}</td>
                        <td className="num">{PESO.format(e.amount)}</td>
                        <td><Badge status={e.status} /></td>
                        <td>{formatDate(e.receiptdate || e.submittedat)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="dash-col">
          <section className="dash-panel">
            <header className="dash-panel-head">
              <h2>{t("dashboard.project_status")}</h2>
              <Link to="/projects" className="dash-link">{t("dashboard.view_all")}</Link>
            </header>
            {!projectsError && projectsLoading && <p className="dashboard-loading">{t("dashboard.loading_projects")}</p>}
            {!projectsError && !projectsLoading && statusRows.length === 0 && (
              <p className="dash-empty">
                {t(canCreate ? "dashboard.no_open_projects_create" : "dashboard.no_open_projects_assigned")}
              </p>
            )}
            {!projectsError && !projectsLoading && statusRows.length > 0 && (
              <ul className="dash-projects">
                {statusRows.map((p) => (
                  <li key={p.projectid}>
                    <div className="dash-project-top">
                      <Link to={`/projects/${p.projectid}`} className="dash-project">{p.name}</Link>
                      <Badge status={p.status} />
                    </div>
                    <span className="dash-sub">{p.projectmanagername || p.clientname}</span>
                    <div className="dash-progress">
                      <ProgressBar value={p.progressPct} />
                      <span className="dash-pct">{p.progressPct}%</span>
                    </div>
                    <div className="dash-flags">
                      <span className={p.overBudget ? "dash-flag dash-flag-bad" : "dash-flag"}>
                        {t("dashboard.budget_used", { percent: Math.round(p.pct) })}
                      </span>
                      {p.overBudget && <span className="dash-flag dash-flag-bad">{t("dashboard.over_budget")}</span>}
                      {p.pastEnd && <span className="dash-flag dash-flag-bad">{t("dashboard.past_end_date")}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {isPM && (
            <NeedsAttentionPanel
              loading={attnLoading}
              tickets={attnTickets}
              reviews={attnReviews}
              milestones={attnMilestones}
            />
          )}

          {canSeeAlerts && (
            <section className="dash-panel">
              <header className="dash-panel-head">
                <h2>{t("dashboard.audit_summary")}</h2>
                <Link to="/blockchain/alerts" className="dash-link">{t("nav.tamper_alerts")}</Link>
              </header>
              <div className="dash-audit">
                <div className={"dash-audit-card" + (tamperedCount > 0 ? " dash-audit-bad" : " dash-audit-good")}>
                  <ShieldIcon />
                  <div>
                    <span className="dash-audit-label">{t("dashboard.secured_records")}</span>
                    <span className="dash-audit-value">{confirmedCount == null ? "—" : confirmedCount}</span>
                    <span className="dash-audit-note">
                      {tamperedCount == null
                        ? ""
                        : tamperedCount === 0
                          ? t("dashboard.none_changed")
                          : t("dashboard.n_changed", { count: tamperedCount })}
                    </span>
                  </div>
                </div>
                <div className={"dash-audit-card" + (alertCount > 0 ? " dash-audit-bad" : " dash-audit-good")}>
                  <AlertIcon />
                  <div>
                    <span className="dash-audit-label">{t("dashboard.open_alerts")}</span>
                    <span className="dash-audit-value">{alertCount == null ? "—" : alertCount}</span>
                    <span className="dash-audit-note">
                      {alertCount == null ? "" : alertCount > 0 ? t("dashboard.needs_review") : t("tamper.nothing")}
                    </span>
                  </div>
                </div>
              </div>
              {pendingChainCount > 0 && (
                <p className="dash-footnote">{pendingChainCount === 1 ? t("dashboard.chain_waiting_one") : t("dashboard.chain_waiting_other", { count: pendingChainCount })}</p>
              )}

              <h3 className="dash-subhead">{t("dashboard.recent_checks")}</h3>
              {recentChecks.length === 0 ? (
                <p className="dash-empty">{t("dashboard.no_checks")}</p>
              ) : (
                <ul className="dash-checks">
                  {recentChecks.map((e) => (
                    <li key={e.expenseid}>
                      <span
                        className={"dash-dot" + (e.blockchainstatus === "TamperDetected" ? " dash-dot-bad" : "")}
                        aria-hidden="true"
                      />
                      <span className="dash-check-name">{e.vendorname} · {PESO.format(e.amount)}</span>
                      <span className="dash-check-time">{timeAgo(e.lastintegritycheckat, t)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, note, to, emphasis }) {
  const body = (
    <>
      <span className="dash-kpi-icon" aria-hidden="true">{icon}</span>
      <span className="dash-kpi-text">
        <span className="dash-stat-label">{label}</span>
        <span className="dash-kpi-value">{value}</span>
        {note && <span className="dash-stat-note">{note}</span>}
      </span>
    </>
  );
  const className = "dash-kpi" + (emphasis ? " dash-kpi-emphasis" : "");
  return to ? <Link to={to} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

const ICON_PROPS = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
function LayersIcon() { return <svg {...ICON_PROPS}><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="m3 13 9 5 9-5" /><path d="m3 17.5 9 5 9-5" opacity=".5" /></svg>; }
function PesoIcon() { return <svg {...ICON_PROPS}><path d="M8 20V4h5a4 4 0 0 1 0 8H8" /><path d="M5 8h11M5 11h11" /></svg>; }
function WalletIcon() { return <svg {...ICON_PROPS}><path d="M4 7a2 2 0 0 1 2-2h11v4" /><path d="M4 7v10a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1H6a2 2 0 0 1-2-2Z" /><circle cx="16" cy="14" r="1" /></svg>; }
function ClipboardIcon() { return <svg {...ICON_PROPS}><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4.5h6M9 11h6M9 15h4" /></svg>; }
function CalendarIcon() { return <svg {...ICON_PROPS} width="16" height="16"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>; }
function ShieldIcon() { return <svg {...ICON_PROPS} width="28" height="28"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>; }
function AlertIcon() { return <svg {...ICON_PROPS} width="28" height="28"><path d="M12 4 2.5 20h19L12 4Z" /><path d="M12 10v4M12 17.2v.1" /></svg>; }

// Plain decorative skyline and crane (no photo needed), tinted by CSS.
function SkylineArt() {
  return (
    <svg className="dash-hero-art" viewBox="0 0 420 120" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
      <g fill="currentColor">
        <rect x="150" y="70" width="46" height="50" opacity=".5" />
        <rect x="205" y="50" width="38" height="70" opacity=".7" />
        <rect x="252" y="80" width="52" height="40" opacity=".45" />
        <rect x="312" y="40" width="44" height="80" opacity=".6" />
        <rect x="364" y="64" width="40" height="56" opacity=".4" />
      </g>
      <g stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity=".85">
        <path d="M88 120V18" /><path d="M76 120V18" />
        <path d="M76 36h12M76 54h12M76 72h12M76 90h12" />
        <path d="M30 18h120" /><path d="M82 18 82 6" />
        <path d="M82 6 44 18M82 6 138 18" />
        <path d="M128 18v26" /><rect x="122" y="44" width="12" height="9" />
      </g>
    </svg>
  );
}

function NeedsAttentionPanel({ loading, tickets, reviews, milestones }) {
  const { t } = useLocale();
  const total = tickets.length + reviews.length + milestones.length;

  return (
    <section className="dash-panel">
      <header className="dash-panel-head">
        <h2>{t("dashboard.attention")}</h2>
      </header>

      {loading && <p className="dashboard-loading">{t("common.loading")}</p>}

      {!loading && total === 0 && (
        <p className="dash-empty">{t("dashboard.attention_clear")}</p>
      )}

      {!loading && total > 0 && (
        <div className="attn-groups">
          {tickets.length > 0 && (
            <AttnGroup
              accent="tickets"
              count={tickets.length}
              label={t("dashboard.tickets_to_assign")}
              to="/tickets/queue"
              linkText={t("dashboard.go_tickets")}
              items={tickets.slice(0, 3).map((tk) => ({
                key: tk.ticketid,
                to: `/tickets/queue?focus=${tk.ticketid}`,
                primary: tk.subject,
                secondary: tk.projectname || tk.projectName,
              }))}
              moreCount={tickets.length - Math.min(3, tickets.length)}
            />
          )}

          {reviews.length > 0 && (
            <AttnGroup
              accent="reviews"
              count={reviews.length}
              label={t("dashboard.submissions_to_review")}
              to="/tasks/progress-review"
              linkText={t("dashboard.review_submissions")}
              items={reviews.slice(0, 3).map((r) => ({
                key: r.logid,
                to: `/tasks/progress-review?focus=${r.logid}`,
                primary: r.taskname,
                secondary: r.projectname,
              }))}
              moreCount={reviews.length - Math.min(3, reviews.length)}
            />
          )}

          {milestones.length > 0 && (
            <AttnGroup
              accent="risk"
              count={milestones.length}
              label={t("dashboard.milestones_at_risk")}
              items={milestones.slice(0, 3).map((m) => ({
                key: m.milestoneid,
                to: `/projects/${m.projectid}`,
                primary: m.name,
                secondary: m.projectname,
                badge: m.status,
              }))}
              moreCount={milestones.length - Math.min(3, milestones.length)}
            />
          )}
        </div>
      )}
    </section>
  );
}

function AttnGroup({ accent, count, label, to, linkText, items, moreCount }) {
  const { t } = useLocale();
  return (
    <div className={`attn-group attn-group-${accent}`}>
      <div className="attn-group-head">
        <span className="attn-label">{label}</span>
        <span className="attn-count">{count}</span>
      </div>
      <ul className="attn-items">
        {items.map((item) => {
          const body = (
            <>
              <span className="attn-item-text">
                <span className="attn-item-primary">{item.primary}</span>
                {item.secondary && <span className="attn-item-secondary">{item.secondary}</span>}
              </span>
              {item.badge && <Badge status={item.badge} />}
            </>
          );
          return (
            <li key={item.key}>
              {item.to
                ? <Link to={item.to} className="attn-item attn-item-link">{body}</Link>
                : <span className="attn-item">{body}</span>}
            </li>
          );
        })}
      </ul>
      {to && linkText ? (
        <p className="attn-foot">
          <Link to={to} className="dash-link">
            {moreCount > 0 ? t("dashboard.link_more", { text: linkText, count: moreCount }) : linkText}
          </Link>
        </p>
      ) : (
        moreCount > 0 && <p className="attn-more">{t("picker.more", { count: moreCount })}</p>
      )}
    </div>
  );
}
