import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useProjects } from "../../utils/useProjects";
import { Banner } from "../../components/ui/Banner";
import { ProjectCard } from "../../components/projects/ProjectCard";
import "./ProjectsListPage.css";

const STATUS_FILTERS = ["All", "Draft", "Active", "Completed", "Archived"];

export function ProjectsListPage() {
  const { user } = useAuth();
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
    return scoped.filter(
      (p) =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.clientname || "").toLowerCase().includes(q)
    );
  }, [projects, search, user.role, user.id]);

  return (
    <div>
      <div className="spread projects-header">
        <div>
          <h1>Projects</h1>
          {!loading && !error && (
            <p className="projects-count">
              {visible.length} {visible.length === 1 ? "project" : "projects"}
            </p>
          )}
        </div>
        {canCreate && (
          <Link to="/projects/new" className="btn btn-primary">
            New Project
          </Link>
        )}
      </div>

      <div className="projects-toolbar">
        <div className="projects-filters">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              className={
                "projects-filter" + (statusFilter === option ? " projects-filter-active" : "")
              }
              onClick={() => setStatusFilter(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="projects-search"
          placeholder="Search by project or client"
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
              : `No ${statusFilter === "All" ? "" : statusFilter.toLowerCase() + " "}projects yet`
          }
        >
          {search
            ? "Try a different project or client name."
            : canCreate
            ? "Create a project to see it appear here."
            : "Projects assigned to you will appear here."}
        </Banner>
      )}

      {!error && !loading && visible.length > 0 && (
        <div className="grid-cards">
          {visible.map((project) => (
            <ProjectCard key={project.projectid} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
