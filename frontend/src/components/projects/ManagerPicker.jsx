import { Field } from "../ui/Field";
import "./ManagerPicker.css";

const DATE = new Intl.DateTimeFormat("en-PH", { year: "numeric", month: "short", day: "numeric" });

function fmt(value) {
  return value ? DATE.format(new Date(value)) : "—";
}

/**
 * Manager dropdown that lists only managers who can take one more project
 * (adviser: "GM selection dropdowns must display only eligible managers"),
 * followed by a short list of the busy ones and what they're working on so
 * the GM can see why they're missing.
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
            {m.name.trim()} ({m.email}){m.openProjectCount ? ` · ${m.openProjectCount} open project(s)` : ""}
          </option>
        ))}
      </Field>

      {!loading && busy.length > 0 && (
        <details className="manager-picker-busy">
          <summary>
            {busy.length} unavailable (limit {limit} open project{limit === 1 ? "" : "s"} each)
          </summary>
          <ul>
            {busy.map((m) => (
              <li key={m.userid}>
                <strong>{m.name.trim()}</strong>
                <ul>
                  {m.openProjects.map((p) => (
                    <li key={p.projectid}>
                      {p.name} · {p.status} · construction {fmt(p.constructionstartdate)} to {fmt(p.enddate)}
                      {p.municipality ? ` · ${p.municipality}` : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
