import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useProjects } from "../../utils/useProjects";
import { Banner } from "../../components/ui/Banner";
import { ProjectStatCards } from "../../components/projects/ProjectStatCards";
import { ProjectCard } from "../../components/projects/ProjectCard";
import "./DashboardPage.css";

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
    return <ProjectsOverview role={user.role} name={user.name} />;
  }
  return <MobileOnlyNotice name={user.name} role={user.role} />;
}

function ProjectsOverview({ role, name }) {
  const { projects, loading, error } = useProjects("Active");
  const canCreate = role === "General Manager";

  return (
    <div className="dashboard">
      <div className="spread dashboard-header">
        <div>
          <h1>Welcome back, {name.split(" ")[0]}</h1>
          <p className="dashboard-subtitle">Here's what's active across your projects.</p>
        </div>
        {canCreate && (
          <Link to="/projects/new" className="btn btn-primary dashboard-cta-link">
            + New Project
          </Link>
        )}
      </div>

      {error && <Banner tone="error" title={error} />}

      {!error && (
        <>
          <ProjectStatCards projects={projects} />

          <div className="spread dashboard-section-head">
            <h2>Active Projects</h2>
            <Link to="/projects" className="dashboard-viewall">
              View all
            </Link>
          </div>

          {loading ? (
            <p className="dashboard-loading">Loading projects…</p>
          ) : projects.length === 0 ? (
            <Banner tone="empty" title="No active projects yet">
              {canCreate
                ? "Create your first project to get started."
                : "Once a General Manager creates a project, it will show up here."}
            </Banner>
          ) : (
            <div className="grid-cards">
              {projects.slice(0, 6).map((project) => (
                <ProjectCard key={project.projectid} project={project} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
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
