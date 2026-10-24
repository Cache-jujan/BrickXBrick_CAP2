import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { niceDay, projectSpan } from "../../utils/reportFilters";
import { PESO_EXACT } from "../../utils/plainLanguage";
import { signedPct, signedPeso, varianceWords } from "../../utils/variance";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ProjectReport.css";

const pct = (value) => (value === null || value === undefined ? "n/a" : `${value.toFixed(1)}%`);

/**
 * The report when exactly ONE project was chosen: a headline for that project
 * (name, status, dates, how much of the budget is used), then where the budget
 * stands. Everything comes from the same /api/reports/summary figures as the
 * multi-project view; "Remaining budget" here is budget minus everything spent
 * up to the end date (the multi-project "Budget left" subtracts this period only).
 *
 * project: the summary entry; info: the project row from the list (may be missing);
 * period: { from, to }.
 */
export function ProjectHero({ project, info, period }) {
  const { t, formatDate } = useLocale();
  const day = (value) => niceDay(value, formatDate);
  const used = project.cumulativeUtilizationPct;
  const remaining = project.budget - project.cumulativeSpend;
  const over = project.overrun || remaining < 0;
  const span = info ? projectSpan(info) : null;
  const dates = span?.start
    ? span.end
      ? t("rep.date_range", { from: day(span.start), to: day(span.end) })
      : t("rep.date_open", { from: day(span.start) })
    : null;
  const ring = used === null || used === undefined ? 0 : Math.min(100, used);

  return (
    <Card className="pr-hero">
      <div className="pr-hero-top">
        <div>
          <h3 className="pr-name">{project.name}</h3>
          {dates && <p className="pr-dates">{dates}</p>}
        </div>
        {info?.status && <Badge status={info.status} />}
      </div>

      <div className="pr-hero-body">
        <div
          className={"pr-ring" + (over ? " pr-ring-over" : "")}
          style={{ "--pr-fill": `${ring * 3.6}deg` }}
          role="img"
          aria-label={t(over ? "rep.pct_used_aria_over" : "rep.pct_used_aria", { pct: pct(used) })}
        >
          <div className="pr-ring-inner">
            <strong>{pct(used)}</strong>
            <span>{over ? t("rep.over_budget_lower") : t("rep.of_budget_used")}</span>
          </div>
        </div>

        <dl className="pr-stats">
          <div>
            <dt>{t("projects.budget")}</dt>
            <dd>{PESO_EXACT.format(project.budget)}</dd>
          </div>
          <div>
            <dt>{t("rep.spent_to_date")}</dt>
            <dd>{PESO_EXACT.format(project.cumulativeSpend)}</dd>
            <small>{t("rep.everything_approved", { date: day(period.to) })}</small>
          </div>
          <div className={remaining < 0 ? "pr-negative" : ""}>
            <dt>{t("rep.remaining")}</dt>
            <dd>{PESO_EXACT.format(remaining)}</dd>
            <small>{remaining < 0 ? t("dashboard.over_budget") : t("rep.budget_minus_spent")}</small>
          </div>
          <div className={project.varianceToDate > 0 ? "pr-negative" : ""}>
            <dt>{t("rep.cost_variance")}</dt>
            <dd>{signedPeso(project.varianceToDate)}</dd>
            <small>{Number.isFinite(project.varianceToDate) ? t("rep.variance_formula", { words: varianceWords(project.varianceToDate, t), pct: signedPct(project.varianceToDatePct) }) : t("rep.variance_formula_plain")}</small>
          </div>
          <div>
            <dt>{t("rep.spent_in_period")}</dt>
            <dd>{PESO_EXACT.format(project.periodSpend)}</dd>
            <small>{t("rep.date_range", { from: day(period.from), to: day(period.to) })}</small>
          </div>
        </dl>
      </div>
    </Card>
  );
}

/** Earlier spend, this period's spend and what is left, as one bar plus a legend. */
export function BudgetStands({ project }) {
  const { t } = useLocale();
  const period = project.periodSpend;
  const earlier = Math.max(0, project.cumulativeSpend - period);
  const remaining = Math.max(0, project.budget - project.cumulativeSpend);
  const whole = Math.max(project.budget, project.cumulativeSpend) || 1;
  const share = (v) => `${(v / whole) * 100}%`;
  const rows = [
    { key: "earlier", label: t("rep.spent_before"), value: earlier },
    { key: "period", label: t("rep.spent_in_period"), value: period },
    { key: "left", label: t("rep.remaining"), value: remaining },
  ];
  const taxShare = period > 0 ? `${((project.birDeductibleSpend / period) * 100).toFixed(0)}%` : "n/a";

  return (
    <>
      <div className={"pr-split" + (project.overrun ? " pr-split-over" : "")} role="img" aria-label={t("rep.split_aria")}>
        <span className="pr-split-earlier" style={{ width: share(earlier) }} />
        <span className="pr-split-period" style={{ width: share(period) }} />
        <span className="pr-split-left" style={{ width: share(remaining) }} />
      </div>
      <ul className={"pr-legend" + (project.overrun ? " pr-split-over" : "")}>
        {rows.map((r) => (
          <li key={r.key}>
            <span className={`pr-dot pr-split-${r.key}`} aria-hidden="true" />
            <span className="pr-legend-label">{r.label}</span>
            <span className="pr-legend-value">{PESO_EXACT.format(r.value)}</span>
          </li>
        ))}
      </ul>
      <p className="pr-tax">
        <strong>{PESO_EXACT.format(project.birDeductibleSpend)}</strong> {t("rep.tax_line_rest", { share: taxShare })}
      </p>
    </>
  );
}
