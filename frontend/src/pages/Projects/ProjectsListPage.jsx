import { useState } from "react";
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
  const { projects, loading, error } = useProjects(
    statusFilter === "All" ? undefined : statusFilter
  );
  const canCreate = user.role === "General Manager";

  return (
    <div>
      <div className="spread projects-header">
        <h1>Projects</h1>
        {canCreate && (
          <Link to="/projects/new" className="btn btn-primary">
            + New Project
          </Link>
        )}
      </div>

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

      {error && <Banner tone="error" title={error} />}

      {!error && loading && <p className="dashboard-loading">Loading projects…</p>}

      {!error && !loading && projects.length === 0 && (
        <Banner tone="empty" title={`No ${statusFilter === "All" ? "" : statusFilter.toLowerCase()} projects yet`}>
          {canCreate
            ? "Create a project to see it appear here."
            : "Projects created by a General Manager will appear here."}
        </Banner>
      )}

      {!error && !loading && projects.length > 0 && (
        <div className="grid-cards">
          {projects.map((project) => (
            <ProjectCard key={project.projectid} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
