import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useProjects } from "../../utils/useProjects";
import { Banner } from "../../components/ui/Banner";
import { Badge } from "../../components/ui/Badge";
import "./ProjectsListPage.css";

const STATUS_FILTERS = ["All", "Draft", "Active", "Completed", "Cancelled", "Archived"];

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" });

function fmtDate(value) {
  return value ? DATE.format(new Date(value)) : null;
}

export function ProjectsListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const { projects, loading, error } = useProjects(
    statusFilter === "All" ? undefined : statusFilter
  );
  const canCreate = user.role === "General Manager";

  // A Project Manager can only open projects assigned to them, so only
  // list those. General Manager sees everything.
  const visible = useMemo(() => {
    const scoped =
      user.role === "Project Manager"
        ? projects.filter((p) => p.projectmanagerid === user.id)
        : projects;
    const q = search.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((p) =>
      [p.name, p.clientname, p.projectmanagername, p.municipality]
        .some((field) => (field || "").toLowerCase().includes(q))
    );
  }, [projects, search, user.role, user.id]);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-text">
          <h1>Projects</h1>
          {!loading && !error && (
            <p className="page-header-sub">
              {visible.length} {visible.length === 1 ? "project" : "projects"}
              {statusFilter !== "All" ? ` · ${statusFilter}` : ""}
            </p>
          )}
        </div>
        {canCreate && (
          <div className="page-header-actions">
            <Link to="/projects/new" className="btn btn-primary">New project</Link>
          </div>
        )}
      </div>

      <div className="projects-toolbar">
        <div className="projects-tabs" role="tablist" aria-label="Filter by status">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={statusFilter === option}
              className={"projects-tab" + (statusFilter === option ? " projects-tab-active" : "")}
              onClick={() => setStatusFilter(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="projects-search"
          placeholder="Search project, client, PM or town"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search projects"
        />
      </div>

      {error && <Banner tone="error" title={error} />}

      {!error && loading && <p className="dashboard-loading">Loading projects…</p>}

      {!error && !loading && visible.length === 0 && (
        <Banner
          tone="empty"
          title={
            search
              ? "No projects match your search"
              : `No ${statusFilter === "All" ? "" : statusFilter.toLowerCase() + " "}projects`
          }
        >
          {search
            ? "Try a different project, client, manager or town."
            : canCreate && statusFilter === "All"
            ? "Create a project once the client has signed the BOM."
            : "Projects assigned to you will appear here."}
        </Banner>
      )}

      {!error && !loading && visible.length > 0 && (
        <div className="table-scroll projects-table-wrap">
          <table className="users-table projects-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>Project Manager</th>
                <th>Site Manager</th>
                <th>Location</th>
                <th>Construction</th>
                <th className="num">Budget</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const from = fmtDate(p.constructionstartdate);
                const to = fmtDate(p.enddate);
                return (
                  <tr
                    key={p.projectid}
                    className="projects-row"
                    onClick={() => navigate(`/projects/${p.projectid}`)}
                  >
                    <td>
                      <Link to={`/projects/${p.projectid}`} className="projects-name" onClick={(e) => e.stopPropagation()}>
                        {p.name}
                      </Link>
                      <span className="projects-client">{p.clientname}</span>
                    </td>
                    <td><Badge status={p.status} /></td>
                    <td>{p.projectmanagername || <span className="muted">—</span>}</td>
                    <td>{p.sitemanagername || <span className="muted">Not assigned</span>}</td>
                    <td>{p.municipality || <span className="muted">—</span>}</td>
                    <td className="projects-dates">
                      {from || to ? (
                        <>
                          {from || "—"}
                          <span className="muted"> to </span>
                          {to || "—"}
                        </>
                      ) : (
                        <span className="muted">Not set</span>
                      )}
                    </td>
                    <td className="num">{PESO.format(p.budget)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
