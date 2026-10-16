import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { MAX_PROJECTS, niceDay, projectSpan, spanOfProjects } from "../../utils/reportFilters";
import "./ReportFilters.css";

function spanText(project) {
  const { start, end } = projectSpan(project);
  if (!start && !end) return "No dates set";
  const finish = project.actualcompletiondate ? "finished" : "target finish";
  return `Starts ${start ? niceDay(start) : "—"} · ${end ? `${finish} ${niceDay(end)}` : "no finish date"}`;
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
  onUseProjectDates,
  onSubmit,
}) {
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
      <fieldset className="report-filters-projects">
        <legend>
          Projects <span className="report-filters-hint">(choose 1 to {MAX_PROJECTS})</span>
        </legend>

        {projectsLoading && <p className="report-filters-note">Loading projects…</p>}
        {projectsError && <p className="report-filters-error">{projectsError}</p>}
        {!projectsLoading && !projectsError && projects.length === 0 && (
          <p className="report-filters-note">There are no projects to report on yet.</p>
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
                    <span className="report-filters-dates-line">{spanText(project)}</span>
                  </span>
                  <Badge status={project.status} />
                </label>
              </li>
            );
          })}
        </ul>
        {errors.projectIds && <p className="report-filters-error">{errors.projectIds}</p>}
      </fieldset>

      <div className="report-filters-dates">
        <Field
          label="From"
          type="date"
          required
          value={value.from}
          error={errors.from}
          onChange={(event) => onDateChange("from", event.target.value)}
        />
        <Field
          label="To"
          type="date"
          required
          value={value.to}
          error={errors.to}
          onChange={(event) => onDateChange("to", event.target.value)}
        />
        {span && (
          <Button type="button" variant="secondary" onClick={onUseProjectDates}>
            Use project dates
          </Button>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Generating…" : "Generate report"}
        </Button>
      </div>

      {span && (
        <p className="report-filters-note">
          The projects you chose run from {niceDay(span.from)} to {niceDay(span.to)}.
          {span.trimmed ? " A report can cover at most 366 days, so the range was cut there." : ""}
        </p>
      )}
    </form>
  );
}
