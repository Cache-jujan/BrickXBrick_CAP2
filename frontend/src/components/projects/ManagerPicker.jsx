import { Field } from "../ui/Field";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ManagerPicker.css";

const SHOWN_PER_MANAGER = 3;

// "construction Feb 1, 2027 to Jun 30, 2027", or whichever half is known.
// Older projects created before the lifecycle dates existed have neither.
function scheduleText(project, t, formatDate) {
  const from = project.constructionstartdate ? formatDate(project.constructionstartdate) : null;
  const to = project.enddate ? formatDate(project.enddate) : null;
  if (from && to) return t("picker.schedule_range", { from, to });
  if (to) return t("picker.schedule_until", { to });
  if (from) return t("picker.schedule_from", { from });
  return null;
}

function ProjectLine({ project }) {
  const { t, tv, formatDate } = useLocale();
  const schedule = scheduleText(project, t, formatDate);
  return (
    <li>
      {project.name}
      <span className="manager-picker-meta">
        {" "}· {tv("status", project.status)} · <span className="manager-picker-progress">{t("picker.percent_complete", { percent: project.progress ?? 0 })}</span>
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
  const { t } = useLocale();
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
        <option value="">{loading ? t("common.loading") : emptyOptionLabel}</option>
        {selectable.map((m) => (
          <option key={m.userid} value={m.userid}>
            {t(m.maxOpenProjects === 1 ? "picker.option_one" : "picker.option_other", { name: m.name.trim(), email: m.email, count: m.openProjectCount, max: m.maxOpenProjects })}
          </option>
        ))}
      </Field>

      {!loading && managers.length > 0 && (
        <details className="manager-picker-busy">
          <summary>
            {busyCount > 0 ? t("picker.see_load_busy", { count: busyCount, limit }) : t("picker.see_load")}
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
                    {" "}· {t("picker.open_count", { count: m.openProjectCount, max: m.maxOpenProjects })}
                  </span>
                  <span className={"manager-picker-tag" + (full ? " is-full" : "")}>
                    {full ? t("picker.at_limit") : t("picker.available")}
                  </span>
                  {shown.length > 0 ? (
                    <ul>
                      {shown.map((p) => (
                        <ProjectLine key={p.projectid} project={p} />
                      ))}
                      {hidden > 0 && <li className="manager-picker-meta">{t("picker.more", { count: hidden })}</li>}
                    </ul>
                  ) : (
                    <p className="manager-picker-meta manager-picker-none">{t("picker.none")}</p>
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
