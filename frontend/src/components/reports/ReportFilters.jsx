import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { MAX_PROJECTS } from "../../utils/reportFilters";
import "./ReportFilters.css";

/**
 * Project multi-select (1 to 5), date range and the Generate button.
 * value: { projectIds, from, to }   errors: { projectIds?, from?, to? }
 * Controlled: the page owns the state.
 */
export function ReportFilters({ projects, projectsLoading, projectsError, value, errors, submitting, onChange, onSubmit }) {
  const atLimit = value.projectIds.length >= MAX_PROJECTS;

  function toggle(projectId) {
    const selected = value.projectIds.includes(projectId);
    onChange({
      ...value,
      projectIds: selected ? value.projectIds.filter((id) => id !== projectId) : [...value.projectIds, projectId],
    });
  }

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
                  <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(project.projectid)} />
                  <span className="report-filters-name">{project.name}</span>
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
          max={value.to || undefined}
          error={errors.from}
          onChange={(event) => onChange({ ...value, from: event.target.value })}
        />
        <Field
          label="To"
          type="date"
          required
          value={value.to}
          min={value.from || undefined}
          error={errors.to}
          onChange={(event) => onChange({ ...value, to: event.target.value })}
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? "Generating…" : "Generate report"}
        </Button>
      </div>
    </form>
  );
}
