import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { listProjects } from "../../api/projectsApi";
import { listExpenses } from "../../api/expensesApi";
import { listTamperAlerts } from "../../api/blockchainApi";
import { extractErrorMessage } from "../../api/client";
import { Banner } from "../../components/ui/Banner";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
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

  // A Project Manager only manages the projects assigned to them — scope
  // "their" numbers to that, mirroring assertProjectAccess on the backend.
  // A General Manager sees everything, same as GET /api/projects broadcast.
  const scopedProjects = role === "Project Manager"
    ? projects.filter((p) => p.projectmanagerid === userId)
    : projects;

  const activeCount = scopedProjects.filter((p) => p.status === "Active").length;
  const totalBudget = scopedProjects.reduce((sum, p) => sum + Number(p.budget || 0), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const pendingApprovals = expenses.filter((e) => e.status === "Pending").length;
  const recentExpenses = [...expenses]
    .sort((a, b) => new Date(b.submittedat) - new Date(a.submittedat))
    .slice(0, 5);
  const recentProjects = [...scopedProjects]
    .sort((a, b) => new Date(b.startdate) - new Date(a.startdate))
    .slice(0, 6);

  const dataError = projectsError || expensesError;

  return (
    <div className="dashboard">
      <div className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <p className="dashboard-hero-eyebrow">Welcome back</p>
          <h1>Good to see you, {name.split(" ")[0]}</h1>
          <p className="dashboard-hero-sub">Here's what's happening across your projects.</p>
        </div>
        {canCreate && (
          <Link to="/projects/new" className="btn btn-primary dashboard-cta-link">
            + New Project
          </Link>
        )}
      </div>

      {dataError && <Banner tone="error" title={dataError} />}

      <div className="stat-cards">
        <StatCard label="Active Projects" value={projectsLoading ? "—" : activeCount} />
        <StatCard label="Total Project Budget" value={projectsLoading ? "—" : PESO.format(totalBudget)} />
        <StatCard label="Total Expenses" value={expensesLoading ? "—" : PESO.format(totalExpenses)} />
        <StatCard label="Pending Approvals" value={expensesLoading ? "—" : pendingApprovals} />
      </div>

      <div className="dashboard-grid">
        <Card className="dashboard-panel dashboard-panel-wide">
          <div className="spread dashboard-panel-head">
            <h2>Project Financial Overview</h2>
            <span className="pending-badge">Pending backend</span>
          </div>
          <div className="pending-panel">
            <p>
              A budget-vs-expense trend chart will appear here once a
              monthly analytics endpoint is available. This panel is not
              showing estimated or fabricated figures.
            </p>
          </div>
        </Card>

        <Card className="dashboard-panel">
          <div className="spread dashboard-panel-head">
            <h2>Blockchain Audit Summary</h2>
          </div>
          {canSeeAlerts ? (
            <div className="chain-summary">
              <div className="chain-summary-row chain-summary-row-pending">
                <div>
                  <p className="chain-summary-label">Verified Records</p>
                  <p className="chain-summary-note">Needs an aggregate endpoint — not shown yet.</p>
                </div>
                <span className="pending-badge">Pending backend</span>
              </div>
              <div className={"chain-summary-row" + (alertCount > 0 ? " chain-summary-row-alert" : "")}>
                <div>
                  <p className="chain-summary-label">Open Tamper Alerts</p>
                  <p className="chain-summary-note">
                    {alertCount == null ? "Loading…" : alertCount === 0 ? "None open right now." : "Requires review and resolution."}
                  </p>
                </div>
                <span className="chain-summary-value">{alertCount == null ? "—" : alertCount}</span>
              </div>
              <Link to="/blockchain/alerts" className="chain-summary-link">View all tamper alerts →</Link>
            </div>
          ) : (
            <div className="pending-panel">
              <p>Visible to General Manager accounts.</p>
            </div>
          )}
        </Card>
      </div>

      <div className="dashboard-grid">
        <Card className="dashboard-panel dashboard-panel-wide">
          <div className="spread dashboard-panel-head">
            <h2>Project Status</h2>
            <Link to="/projects" className="dashboard-viewall">View all →</Link>
          </div>

          {!projectsError && projectsLoading && <p className="dashboard-loading">Loading projects…</p>}
          {!projectsError && !projectsLoading && recentProjects.length === 0 && (
            <div className="pending-panel">
              <p>{canCreate ? "Create a project to see it appear here." : "No projects assigned to you yet."}</p>
            </div>
          )}
          {!projectsError && !projectsLoading && recentProjects.length > 0 && (
            <ul className="dashboard-project-list">
              {recentProjects.map((p) => (
                <li key={p.projectid} className="dashboard-project-row">
                  <Link to={`/projects/${p.projectid}`} className="dashboard-project-name">{p.name}</Link>
                  <span className="dashboard-project-client">{p.clientname}</span>
                  <Badge status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="dashboard-panel">
          <div className="spread dashboard-panel-head">
            <h2>Recent Expenses</h2>
          </div>
          {!expensesError && expensesLoading && <p className="dashboard-loading">Loading expenses…</p>}
          {!expensesError && !expensesLoading && recentExpenses.length === 0 && (
            <div className="pending-panel"><p>No expenses recorded yet.</p></div>
          )}
          {!expensesError && !expensesLoading && recentExpenses.length > 0 && (
            <ul className="dashboard-expense-list">
              {recentExpenses.map((e) => (
                <li key={e.expenseid} className="dashboard-expense-row">
                  <div>
                    <p className="dashboard-expense-vendor">{e.vendorname}</p>
                    <p className="dashboard-expense-date">{DATE.format(new Date(e.submittedat))}</p>
                  </div>
                  <div className="dashboard-expense-right">
                    <span className="dashboard-expense-amount">{PESO.format(e.amount)}</span>
                    <Badge status={e.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <Card className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
    </Card>
  );
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
      <div className="dashboard-header">
        <h1>System Administration</h1>
        <p className="dashboard-subtitle">
          Manage user accounts, roles, and account lockouts.
        </p>
      </div>
      <Link to="/admin/users" className="admin-overview-link">
        Go to User Accounts →
      </Link>
    </div>
  );
}
