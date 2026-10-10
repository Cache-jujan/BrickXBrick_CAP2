import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { listProjects } from "../../api/projectsApi";
import { listExpenses } from "../../api/expensesApi";
import { listTamperAlerts, getBlockchainSummary } from "../../api/blockchainApi";
import { extractErrorMessage } from "../../api/client";
import { Banner } from "../../components/ui/Banner";
import { Badge } from "../../components/ui/Badge";
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

  if (user.role === "System Administrator") {
    return <AdminOverview />;
  }
  if (WEB_ROLES.includes(user.role)) {
    return <ProjectsOverview role={user.role} name={user.name} userId={user.id} />;
  }
  return <MobileOnlyNotice name={user.name} role={user.role} />;
}

function ProjectsOverview({ role, name, userId }) {
  const canCreate = role === "General Manager";
  const canSeeAlerts = role === "General Manager"; // matches backend requireRole on /alerts

  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState("");

  const [expenses, setExpenses] = useState([]);
  const [expensesLoading, setExpensesLoading] = useState(true);
  const [expensesError, setExpensesError] = useState("");

  const [alertCount, setAlertCount] = useState(null);
  const [confirmedCount, setConfirmedCount] = useState(null);
  const [tamperedCount, setTamperedCount] = useState(null);

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
      return { ...p, budgetValue: budget, spent, pct: budget > 0 ? (spent / budget) * 100 : 0 };
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="dash-footnote">Counts approved expenses only. Pending ones are added once a reviewer approves them.</p>
        </section>

        <div className="dash-side">
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

function MobileOnlyNotice({ name, role }) {
  return (
    <div className="dashboard mobile-only">
      <h1>Welcome, {name.split(" ")[0]}</h1>
      <p className="dashboard-subtitle">
        The {role} role works from the Brick x Brick mobile app, not this web
        dashboard. Please open the app on your Android device to continue.
      </p>
    </div>
  );
}

function AdminOverview() {
  return (
    <div className="dashboard">
      <div className="page-header">
        <div className="page-header-text">
          <h1>System administration</h1>
          <p className="page-header-sub">Create accounts, change roles, reset passwords and unlock accounts.</p>
        </div>
        <div className="page-header-actions">
          <Link to="/admin/users" className="btn btn-primary">User accounts</Link>
        </div>
      </div>
    </div>
  );
}
