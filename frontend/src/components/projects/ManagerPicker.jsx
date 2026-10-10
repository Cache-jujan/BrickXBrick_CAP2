import { Field } from "../ui/Field";
import "./ManagerPicker.css";

const DATE = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" });
const SHOWN_PER_MANAGER = 3;

// "construction Feb 1, 2027 to Jun 30, 2027", or whichever half is known.
// Older projects created before the lifecycle dates existed have neither.
function scheduleText(project) {
  const from = project.constructionstartdate ? DATE.format(new Date(project.constructionstartdate)) : null;
  const to = project.enddate ? DATE.format(new Date(project.enddate)) : null;
  if (from && to) return `construction ${from} to ${to}`;
  if (to) return `until ${to}`;
  if (from) return `construction from ${from}`;
  return null;
}

/**
 * Manager dropdown that lists only managers who can take one more project
 * (adviser: "GM selection dropdowns must display only eligible managers"),
 * followed by a collapsed list of the busy ones and what they're working on,
 * so the GM can see why they're missing (adviser: consider their schedules).
 *
 * managers: rows from /eligible-managers or /eligible-site-managers
 * currentId: the manager already on this project (always selectable)
 */
export function ManagerPicker({
  label,
  required,
  managers,
  loading,
  value,
  currentId,
  error,
  emptyOptionLabel,
  onChange,
  disabled,
}) {
  const selectable = managers.filter((m) => m.available || m.userid === currentId);
  const busy = managers.filter((m) => !m.available && m.userid !== currentId);
  const limit = managers[0]?.maxOpenProjects;

  return (
    <div className="manager-picker">
      <Field
        label={label}
        as="select"
        required={required}
        value={value}
        error={error}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{loading ? "Loading…" : emptyOptionLabel}</option>
        {selectable.map((m) => (
          <option key={m.userid} value={m.userid}>
            {m.name.trim()} ({m.email})
            {m.openProjectCount ? ` · ${m.openProjectCount} of ${m.maxOpenProjects} projects` : ""}
          </option>
        ))}
      </Field>

      {!loading && busy.length > 0 && (
        <details className="manager-picker-busy">
          <summary>
            {busy.length} not available (already at {limit} open project{limit === 1 ? "" : "s"})
          </summary>
          <ul className="manager-picker-list">
            {busy.map((m) => {
              const shown = m.openProjects.slice(0, SHOWN_PER_MANAGER);
              const hidden = m.openProjects.length - shown.length;
              return (
                <li key={m.userid}>
                  <strong>{m.name.trim()}</strong>
                  <span className="manager-picker-count"> · {m.openProjectCount} open</span>
                  <ul>
                    {shown.map((p) => {
                      const schedule = scheduleText(p);
                      return (
                        <li key={p.projectid}>
                          {p.name}
                          {schedule ? <span className="manager-picker-meta"> · {schedule}</span> : null}
                        </li>
                      );
                    })}
                    {hidden > 0 && <li className="manager-picker-meta">+{hidden} more</li>}
                  </ul>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
