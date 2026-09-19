import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getProjectOverview } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { Banner } from "../../components/ui/Banner";
import { MilestoneCard } from "../../components/milestones/MilestoneCard";
import "./ProjectDetailPage.css";

const PESO = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const DATE = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function ProjectDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [project, setProject] = useState(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setAccessDenied(false);
    getProjectOverview(id)
      .then((data) => {
        if (!cancelled) setProject(data);
      })
      .catch((err) => {
        if (cancelled) return;
        // assertProjectAccess in projects.js 403s a Project Manager who
        // isn't this project's projectmanagerid — the plain project list
        // still broadcasts to every PM, so this is a reachable, expected
        // state rather than an actual error.
        if (err?.response?.status === 403) {
          setAccessDenied(true);
        } else {
          setError(extractErrorMessage(err, "Couldn't load this project."));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <p className="dashboard-loading">Loading project…</p>;

  if (accessDenied) {
    return (
      <Banner tone="info" title="You don't manage this project">
        Only this project's assigned Project Manager or a General Manager can view its details.
      </Banner>
    );
  }
  if (error) return <Banner tone="error" title={error} />;
  if (!project) return null;

  // Only the owning Project Manager may add milestones/tasks — mirrors
  // getOwnedProject's check in backend/src/routes/milestones.js. General
  // Manager sees the same section, read-only.
  const canManage = user.role === "Project Manager" && project.projectmanagerid === user.id;
  // POST /:id/tasks 400s if the project has no Site Manager assigned —
  // gate the "+ Add Task" affordance on it instead of letting a PM hit
  // that dead end on the create-task page.
  const hasSiteManager = Boolean(project.sitemanagerid);

  return (
    <div className="project-detail">
      <Link to="/projects" className="project-detail-back">
        ← Back to Projects
      </Link>

      <div className="spread project-detail-header">
        <h1>{project.name}</h1>
        <Badge status={project.status} />
      </div>
      <p className="project-detail-client">{project.clientname}</p>

      {project.description && (
        <Card className="project-detail-description">
          <p>{project.description}</p>
        </Card>
      )}

      <div className="project-detail-facts">
        <Fact label="Budget" value={PESO.format(project.budget)} />
        <Fact label="Start Date" value={DATE.format(new Date(project.startdate))} />
        <Fact
          label="Expected End Date"
          value={project.enddate ? DATE.format(new Date(project.enddate)) : "Not set"}
        />
        <Fact label="Overall Progress" value={`${Number(project.progress || 0)}%`} />
      </div>

      <div className="project-detail-milestones">
        <div className="spread project-detail-section-head">
          <h2>Milestones</h2>
          {canManage && (
            <Link to={`/projects/${project.projectid}/milestones/new`} className="btn btn-primary">
              + Add Milestone
            </Link>
          )}
        </div>

        {!hasSiteManager && canManage && (
          <Banner tone="info" title="No Site Manager assigned">
            You can still add milestones, but tasks can't be created until a Site Manager is
            assigned to this project.
          </Banner>
        )}

        {project.milestones.length === 0 ? (
          <Banner tone="empty" title="No milestones yet">
            {canManage
              ? "Break this project down by adding its first milestone."
              : "The Project Manager hasn't added any milestones yet."}
          </Banner>
        ) : (
          <div className="stack project-detail-milestone-list">
            {project.milestones.map((milestone) => (
              <MilestoneCard
                key={milestone.milestoneid}
                milestone={milestone}
                projectId={project.projectid}
                canManage={canManage}
                hasSiteManager={hasSiteManager}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }) {
  return (
    <div className="project-detail-fact">
      <p className="project-detail-fact-label">{label}</p>
      <p className="project-detail-fact-value">{value}</p>
    </div>
  );
}
