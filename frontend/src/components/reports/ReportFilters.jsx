import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { MAX_PROJECTS, niceDay, projectSpan, quickRanges, spanOfProjects } from "../../utils/reportFilters";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ReportFilters.css";

function spanText(project, t, formatDate) {
  const { start, end } = projectSpan(project);
  if (!start && !end) return t("rep.no_dates");
  const startText = start ? niceDay(start, formatDate) : "—";
  if (!end) return t("rep.span_starts_open", { start: startText });
  const finish = project.actualcompletiondate ? t("rep.finished") : t("rep.target_finish");
  return t("rep.span_starts", { start: startText, finish, end: niceDay(end, formatDate) });
}

/**
 * Project multi-select (1 to 5) showing each project's dates, the date range
 * and the Generate button. Controlled: the page owns the state.
 * value: { projectIds, from, to }   errors: { projectIds?, from?, to? }
 */
export function ReportFilters({
  projects,
  projectsLoading,
  projectsError,
  value,
  errors,
  submitting,
  onToggleProject,
  onDateChange,
  onRangeChange,
  onClearProjects,
  onSelectActive,
  activeCount = 0,
  onUseProjectDates,
  onSubmit,
}) {
  const { t, formatDate } = useLocale();
  const atLimit = value.projectIds.length >= MAX_PROJECTS;
  const selected = projects.filter((p) => value.projectIds.includes(p.projectid));
  const span = spanOfProjects(selected);

  return (
    <form
      className="report-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="report-filters-layout">
      <fieldset className="report-filters-projects">
        <legend>
          {t("nav.projects")} <span className="report-filters-hint">{t("rep.choose_range", { max: MAX_PROJECTS })}</span>
        </legend>
        <div className="report-filters-count">
          <span>{t("rep.n_selected", { count: value.projectIds.length, max: MAX_PROJECTS })}</span>
          {activeCount > 0 && (
            <button type="button" className="report-filters-clear" onClick={onSelectActive}>
              {activeCount > MAX_PROJECTS ? t("rep.select_active_first", { max: MAX_PROJECTS }) : t("rep.select_active")}
            </button>
          )}
          {value.projectIds.length > 0 && (
            <button type="button" className="report-filters-clear" onClick={onClearProjects}>{t("rep.clear")}</button>
          )}
        </div>

        {projectsLoading && <p className="report-filters-note">{t("dashboard.loading_projects")}</p>}
        {projectsError && <p className="report-filters-error">{projectsError}</p>}
        {!projectsLoading && !projectsError && projects.length === 0 && (
          <p className="report-filters-note">{t("rep.no_projects")}</p>
        )}

        <ul className="report-filters-list">
          {projects.map((project) => {
            const checked = value.projectIds.includes(project.projectid);
            const disabled = !checked && atLimit;
            return (
              <li key={project.projectid}>
                <label className={"report-filters-option" + (disabled ? " report-filters-option-disabled" : "")}>
                  <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggleProject(project.projectid)} />
                  <span className="report-filters-text">
                    <span className="report-filters-name">{project.name}</span>
                    <span className="report-filters-dates-line">{spanText(project, t, formatDate)}</span>
                  </span>
                  <Badge status={project.status} />
                </label>
              </li>
            );
          })}
        </ul>
        {errors.projectIds && <p className="report-filters-error">{errors.projectIds}</p>}
      </fieldset>

      <div className="report-filters-side">
      <p className="report-filters-side-title">{t("dashboard.period")}</p>
      <div className="report-filters-quick" role="group" aria-label={t("rep.quick_periods")}>
        {quickRanges().map((range) => {
          const active = value.from === range.from && value.to === range.to;
          return (
            <button
              key={range.labelKey}
              type="button"
              className={"report-filters-chip" + (active ? " report-filters-chip-active" : "")}
              onClick={() => onRangeChange(range.from, range.to)}
            >
              {t(range.labelKey)}
            </button>
          );
        })}
      </div>
      <div className="report-filters-dates">
        <Field
          label={t("rep.from")}
          type="date"
          required
          value={value.from}
          error={errors.from}
          onChange={(event) => onDateChange("from", event.target.value)}
        />
        <Field
          label={t("rep.to")}
          type="date"
          required
          value={value.to}
          error={errors.to}
          onChange={(event) => onDateChange("to", event.target.value)}
        />
      </div>
      {span && (
        <p className="report-filters-note">
          {t("rep.projects_run", { from: niceDay(span.from, formatDate), to: niceDay(span.to, formatDate) })}
          {span.trimmed ? ` ${t("rep.trimmed")}` : ""}
        </p>
      )}
      <div className="report-filters-submit">
        {span && (
          <Button type="button" variant="secondary" onClick={onUseProjectDates}>
            {t("rep.use_project_dates")}
          </Button>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? t("rep.generating") : t("rep.generate")}
        </Button>
      </div>
      </div>
      </div>
    </form>
  );
}
