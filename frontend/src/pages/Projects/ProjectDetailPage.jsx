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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getProjectOverview(id)
      .then((data) => {
        if (!cancelled) setProject(data);
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err, "Couldn't load this project."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <p className="dashboard-loading">Loading project…</p>;
  if (error) return <Banner tone="error" title={error} />;
  if (!project) return null;

  // Only the Project Manager who owns this project may add milestones/
  // tasks — mirrors getOwnedProject's check in backend/src/routes/
  // milestones.js. General Manager sees the same section read-only.
  const canManage = user.role === "Project Manager" && project.projectmanagerid === user.id;

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
