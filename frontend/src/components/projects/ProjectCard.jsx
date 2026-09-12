import { Link } from "react-router-dom";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import "./ProjectCard.css";

const PESO = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const DATE = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function ProjectCard({ project }) {
  return (
    <Card className="project-card">
      <Link to={`/projects/${project.projectid}`} className="project-card-link">
        <div className="project-card-head">
          <h3 className="project-card-name">{project.name}</h3>
          <Badge status={project.status} />
        </div>
        <p className="project-card-client">{project.clientname}</p>
        <div className="project-card-meta">
          <span>{PESO.format(project.budget)}</span>
          <span aria-hidden="true">·</span>
          <span>Starts {DATE.format(new Date(project.startdate))}</span>
        </div>
      </Link>
    </Card>
  );
}
