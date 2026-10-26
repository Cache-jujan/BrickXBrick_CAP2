import { Card } from "../ui/Card";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ProjectStatCards.css";

const PESO = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

export function ProjectStatCards({ projects }) {
  const { t } = useLocale();
  const active = projects.filter((p) => p.status === "Active").length;
  const totalBudget = projects.reduce((sum, p) => sum + Number(p.budget || 0), 0);

  const stats = [
    { label: t("projects.total"), value: projects.length },
    { label: t("dashboard.active_projects"), value: active },
    { label: t("projects.combined_budget"), value: PESO.format(totalBudget) },
  ];

  return (
    <div className="stat-cards">
      {stats.map((stat) => (
        <Card key={stat.label} className="stat-card">
          <p className="stat-label">{stat.label}</p>
          <p className="stat-value">{stat.value}</p>
        </Card>
      ))}
    </div>
  );
}
