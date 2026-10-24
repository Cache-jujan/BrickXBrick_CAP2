import { Link } from "react-router-dom";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ProjectCard.css";

const PESO = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

export function ProjectCard({ project }) {
  const { t, formatDate } = useLocale();
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
          <span>
            {project.constructionstartdate
              ? t("projects.construction_on", { date: formatDate(project.constructionstartdate) })
              : t("projects.development_on", { date: formatDate(project.startdate) })}
          </span>
          {project.municipality && (
            <>
              <span aria-hidden="true">·</span>
              <span>{project.municipality}</span>
            </>
          )}
        </div>
      </Link>
    </Card>
  );
}
