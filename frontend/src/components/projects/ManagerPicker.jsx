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

function ProjectLine({ project }) {
  const schedule = scheduleText(project);
  return (
    <li>
      {project.name}
      <span className="manager-picker-meta">
        {" "}· {project.status} · <span className="manager-picker-progress">{project.progress ?? 0}% complete</span>
        {schedule ? ` · ${schedule}` : ""}
      </span>
    </li>
  );
}

/**
 * Manager dropdown that lists only managers who can take one more project
 * (adviser: "GM selection dropdowns must display only eligible managers"),
 * then a collapsed list of EVERY manager with their current load: each open
 * project with its status, % complete and schedule, so the GM sees how busy
 * someone is, not just whether they're at the limit (adviser item 4).
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
  const busyCount = managers.filter((m) => !m.available && m.userid !== currentId).length;
  const limit = managers[0]?.maxOpenProjects;
  // Free managers first, then the least loaded, so the best choices read first.
  const byLoad = [...managers].sort(
    (a, b) => Number(b.available) - Number(a.available) || a.openProjectCount - b.openProjectCount
  );

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
            {m.name.trim()} ({m.email}) · {m.openProjectCount} of {m.maxOpenProjects} project
            {m.maxOpenProjects === 1 ? "" : "s"}
          </option>
        ))}
      </Field>

      {!loading && managers.length > 0 && (
        <details className="manager-picker-busy">
          <summary>
            See each manager&apos;s current load
            {busyCount > 0 ? ` (${busyCount} at the limit of ${limit})` : ""}
          </summary>
          <ul className="manager-picker-list">
            {byLoad.map((m) => {
              const shown = m.openProjects.slice(0, SHOWN_PER_MANAGER);
              const hidden = m.openProjects.length - shown.length;
              const full = !m.available && m.userid !== currentId;
              return (
                <li key={m.userid}>
                  <strong>{m.name.trim()}</strong>
                  <span className="manager-picker-count">
                    {" "}· {m.openProjectCount} of {m.maxOpenProjects} open
                  </span>
                  <span className={"manager-picker-tag" + (full ? " is-full" : "")}>
                    {full ? "At limit" : "Available"}
                  </span>
                  {shown.length > 0 ? (
                    <ul>
                      {shown.map((p) => (
                        <ProjectLine key={p.projectid} project={p} />
                      ))}
                      {hidden > 0 && <li className="manager-picker-meta">+{hidden} more</li>}
                    </ul>
                  ) : (
                    <p className="manager-picker-meta manager-picker-none">No open projects</p>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
