import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getProject } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { Banner } from "../../components/ui/Banner";
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
  const [project, setProject] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getProject(id)
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
