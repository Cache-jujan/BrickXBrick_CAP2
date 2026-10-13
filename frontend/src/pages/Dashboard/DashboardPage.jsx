import { useEffect, useState } from "react";
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
import "./DashboardPage.css";

const PESO = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});
const DATE = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" });

// Per the Process spec: the web dashboard is for General Manager and
// Project Manager (plus System Administrator for account management).
// Site Manager and Purchaser are mobile-only roles — see /mobile app.
const WEB_ROLES = ["General Manager", "Project Manager"];

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

function ProjectsOverview({ role, name, userId }) {
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
  const [tamperedCount, setTamperedCount] = useState(null);

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
      .catch((err) => { if (!cancelled) setProjectsError(extractErrorMessage(err, "Couldn't load projects.")); })
      .finally(() => { if (!cancelled) setProjectsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listExpenses()
      .then((data) => { if (!cancelled) setExpenses(data); })
      .catch((err) => { if (!cancelled) setExpensesError(extractErrorMessage(err, "Couldn't load expenses.")); })
      .finally(() => { if (!cancelled) setExpensesLoading(false); });
    return () => { cancelled = true; };
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
  const openApproved = openProjects.reduce((sum, p) => sum + (approvedByProject[p.projectid] || 0), 0);
  const pendingAmount = pending.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const usedPct = openBudget > 0 ? Math.round((openApproved / openBudget) * 100) : 0;

  // Open projects, most budget used first, so overruns are at the top.
  const budgetRows = openProjects
    .map((p) => {
      const budget = Number(p.budget || 0);
      const spent = approvedByProject[p.projectid] || 0;
      return {
        ...p,
        budgetValue: budget,
        spent,
        pct: budget > 0 ? (spent / budget) * 100 : 0,
        // Overall completion = mean of milestone completion %, from the list
        // query's progress subquery (projects.js GET /).
        progressPct: Math.round(Number(p.progress || 0)),
      };
    })
    .sort((a, b) => b.pct - a.pct);

  const recentExpenses = [...expenses]
    .sort((a, b) => new Date(b.submittedat) - new Date(a.submittedat))
    .slice(0, 6);

  const dataError = projectsError || expensesError;
  const today = new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date());

  return (
    <div className="dashboard">
      <div className="page-header">
        <div className="page-header-text">
          <h1>Dashboard</h1>
          <p className="page-header-sub">
            {today} · {role === "General Manager" ? "All projects" : `Projects managed by ${name.split(" ")[0]}`}
          </p>
        </div>
        {canCreate && (
          <div className="page-header-actions">
            <Link to="/projects/new" className="btn btn-primary">New project</Link>
          </div>
        )}
      </div>

      {dataError && <Banner tone="error" title={dataError} />}

      <section className="dash-stats" aria-label="Summary">
        <Stat
          label="Active projects"
          value={projectsLoading ? "—" : activeCount}
          note={projectsLoading ? null : `${draftCount} in draft`}
        />
        <Stat
          label="Budget of open projects"
          value={projectsLoading ? "—" : PESO.format(openBudget)}
          note="Draft and Active"
        />
        <Stat
          label="Approved spending"
          value={expensesLoading ? "—" : PESO.format(openApproved)}
          note={expensesLoading || !openBudget ? null : `${usedPct}% of open budget`}
        />
        <Stat
          label="Waiting for approval"
          value={expensesLoading ? "—" : pending.length}
          note={expensesLoading || !pending.length ? "Nothing pending" : PESO.format(pendingAmount)}
          to={pending.length ? "/expenses" : null}
          emphasis={pending.length > 0}
        />
      </section>

      <div className="dash-grid">
        <section className="dash-panel">
          <header className="dash-panel-head">
            <h2>Budget vs. approved spending</h2>
            <Link to="/projects" className="dash-link">All projects</Link>
          </header>

          {!projectsError && projectsLoading && <p className="dashboard-loading">Loading projects…</p>}
          {!projectsError && !projectsLoading && budgetRows.length === 0 && (
            <p className="dash-empty">
              {canCreate ? "No open projects. Create one once the client has signed the BOM." : "No open projects assigned to you."}
            </p>
          )}
          {!projectsError && !projectsLoading && budgetRows.length > 0 && (
            <div className="table-scroll">
              <table className="dash-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Status</th>
                    <th className="num">Budget</th>
                    <th className="num">Approved</th>
                    <th className="dash-used-col">Used</th>
                    <th className="dash-progress-col">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {budgetRows.map((p) => (
                    <tr key={p.projectid}>
                      <td>
                        <Link to={`/projects/${p.projectid}`} className="dash-project">{p.name}</Link>
                        <span className="dash-sub">{p.projectmanagername || p.clientname}</span>
                      </td>
                      <td><Badge status={p.status} /></td>
                      <td className="num">{PESO.format(p.budgetValue)}</td>
                      <td className="num">{expensesLoading ? "—" : PESO.format(p.spent)}</td>
                      <td className="dash-used-col">
                        <div className="dash-used">
                          <span className="dash-bar" aria-hidden="true">
                            <span
                              className={"dash-bar-fill" + (p.pct > 100 ? " dash-bar-over" : "")}
                              style={{ width: `${Math.min(100, p.pct)}%` }}
                            />
                          </span>
                          <span className={"dash-pct" + (p.pct > 100 ? " dash-pct-over" : "")}>
                            {Math.round(p.pct)}%
                          </span>
                        </div>
                      </td>
                      <td className="dash-progress-col">
                        <div className="dash-progress">
                          <ProgressBar value={p.progressPct} />
                          <span className="dash-pct">{p.progressPct}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="dash-footnote">Counts approved expenses only. Pending ones are added once a reviewer approves them.</p>
        </section>

        <div className="dash-side">
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
                <h2>Record protection</h2>
                <Link to="/blockchain/alerts" className="dash-link">Tamper alerts</Link>
              </header>
              <dl className="dash-kv">
                <div>
                  <dt>Approved expenses secured</dt>
                  <dd>{confirmedCount == null ? "—" : confirmedCount}</dd>
                </div>
                <div className={tamperedCount > 0 ? "dash-kv-alert" : ""}>
                  <dt>Changed after approval</dt>
                  <dd>{tamperedCount == null ? "—" : tamperedCount}</dd>
                </div>
                <div className={alertCount > 0 ? "dash-kv-alert" : ""}>
                  <dt>Alerts to review</dt>
                  <dd>{alertCount == null ? "—" : alertCount}</dd>
                </div>
              </dl>
            </section>
          )}

          <section className="dash-panel">
            <header className="dash-panel-head">
              <h2>Recent expenses</h2>
              <Link to="/expenses" className="dash-link">All expenses</Link>
            </header>
            {!expensesError && expensesLoading && <p className="dashboard-loading">Loading expenses…</p>}
            {!expensesError && !expensesLoading && recentExpenses.length === 0 && (
              <p className="dash-empty">No expenses recorded yet.</p>
            )}
            {!expensesError && !expensesLoading && recentExpenses.length > 0 && (
              <ul className="dash-expenses">
                {recentExpenses.map((e) => (
                  <li key={e.expenseid}>
                    <div className="dash-expense-main">
                      <span className="dash-expense-vendor">{e.vendorname}</span>
                      <span className="dash-sub">
                        {projectNames[e.projectid] || "Project"} · {DATE.format(new Date(e.receiptdate || e.submittedat))}
                      </span>
                    </div>
                    <div className="dash-expense-right">
                      <span className="num">{PESO.format(e.amount)}</span>
                      <Badge status={e.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, note, to, emphasis }) {
  const body = (
    <>
      <span className="dash-stat-label">{label}</span>
      <span className="dash-stat-value">{value}</span>
      {note && <span className="dash-stat-note">{note}</span>}
    </>
  );
  const className = "dash-stat" + (emphasis ? " dash-stat-emphasis" : "");
  return to ? <Link to={to} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

function NeedsAttentionPanel({ loading, tickets, reviews, milestones }) {
  const total = tickets.length + reviews.length + milestones.length;

  return (
    <section className="dash-panel">
      <header className="dash-panel-head">
        <h2>Needs your attention</h2>
      </header>

      {loading && <p className="dashboard-loading">Loading…</p>}

      {!loading && total === 0 && (
        <p className="dash-empty">You’re all caught up — nothing needs action right now.</p>
      )}

      {!loading && total > 0 && (
        <div className="attn-groups">
          {tickets.length > 0 && (
            <AttnGroup
              accent="tickets"
              count={tickets.length}
              label="Tickets to assign"
              to="/tickets/queue"
              linkText="Go to tickets"
              items={tickets.slice(0, 3).map((t) => ({
                key: t.ticketid,
                to: `/tickets/queue?focus=${t.ticketid}`,
                primary: t.subject,
                secondary: t.projectname || t.projectName,
              }))}
              moreCount={tickets.length - Math.min(3, tickets.length)}
            />
          )}

          {reviews.length > 0 && (
            <AttnGroup
              accent="reviews"
              count={reviews.length}
              label="Submissions to review"
              to="/tasks/progress-review"
              linkText="Review submissions"
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
              label="Milestones at risk"
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
            {linkText}{moreCount > 0 ? ` · +${moreCount} more` : ""}
          </Link>
        </p>
      ) : (
        moreCount > 0 && <p className="attn-more">+{moreCount} more</p>
      )}
    </div>
  );
}