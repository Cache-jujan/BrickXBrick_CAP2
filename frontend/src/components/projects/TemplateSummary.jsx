import { useEffect, useRef, useState } from "react";
import { getCopySource, getProjectTemplate } from "../../api/projectTemplatesApi";
import "./TemplateSummary.css";

const SIZE_LABEL = { small: "Small", large: "Large", custom: "Custom" };
const PHASE_LABEL = { Planning: "Pre-construction", Construction: "Construction" };

const included = (task) => task.defaultIncluded !== false;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Numbers for the summary: milestones, tasks that start ticked, per phase, optional ones, who handles them. */
export function summarize(detail) {
  const milestones = Array.isArray(detail?.milestones) ? detail.milestones : [];
  const phases = new Map();
  const handlers = new Map();
  let tasks = 0;
  let optional = 0;
  for (const milestone of milestones) {
    const phase = milestone.phase === "Planning" ? "Planning" : "Construction";
    if (!phases.has(phase)) phases.set(phase, { phase, milestones: [], tasks: 0 });
    const group = phases.get(phase);
    const list = Array.isArray(milestone.tasks) ? milestone.tasks : [];
    const count = list.filter(included).length;
    group.milestones.push({ ...milestone, taskList: list, taskCount: count });
    group.tasks += count;
    tasks += count;
    for (const task of list) {
      if (!included(task)) continue;
      if (task.selectable) optional += 1;
      if (task.handledBy) handlers.set(task.handledBy, (handlers.get(task.handledBy) || 0) + 1);
    }
  }
  const ordered = ["Planning", "Construction"].filter((p) => phases.has(p)).map((p) => phases.get(p));
  return { milestones: milestones.length, tasks, optional, phases: ordered, handlers: [...handlers.entries()] };
}

/**
 * The details of the chosen template (or past project): what it contains, in which phase and who handles it.
 * `value` is the gallery's current choice; `template` is its card (for the description and size).
 */
export function TemplateSummary({ value, template }) {
  const cache = useRef(new Map());
  const [state, setState] = useState({ status: "idle", detail: null });
  const id = value?.mode === "template" ? value.templateId : value?.mode === "copy" ? value.sourceProjectId : null;
  const key = id ? `${value.mode}:${id}` : null;

  useEffect(() => {
    if (!key) {
      setState({ status: "idle", detail: null });
      return undefined;
    }
    if (cache.current.has(key)) {
      setState({ status: "ready", detail: cache.current.get(key) });
      return undefined;
    }
    let cancelled = false;
    setState({ status: "loading", detail: null });
    const load = value.mode === "template" ? getProjectTemplate(id) : getCopySource(id);
    load
      .then((detail) => {
        cache.current.set(key, detail);
        if (!cancelled) setState({ status: "ready", detail });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", detail: null });
      });
    return () => {
      cancelled = true;
    };
    // value.mode and id are already folded into key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return null;
  const summary = state.detail ? summarize(state.detail) : null;
  const size = template ? SIZE_LABEL[template.size] || template.size : null;

  return (
    <aside className="tsum" aria-label="Details of the chosen starting point" aria-live="polite">
      <h3 className="tsum-title">{value.name}</h3>
      <p className="tsum-kind">
        {[value.projectType, size, value.mode === "copy" ? "Past project" : "Template"].filter(Boolean).join(" · ")}
      </p>
      {template?.description && <p className="tsum-desc">{template.description}</p>}

      {state.status === "loading" && <p className="tsum-note">Loading the details…</p>}
      {state.status === "error" && <p className="tsum-note">The details could not be loaded. You can still continue.</p>}

      {summary && (
        <>
          <dl className="tsum-stats">
            <div><dt>Milestones</dt><dd>{summary.milestones}</dd></div>
            <div><dt>Tasks</dt><dd>{summary.tasks}</dd></div>
            {summary.optional > 0 && <div><dt>Optional documents</dt><dd>{summary.optional}</dd></div>}
          </dl>

          {summary.handlers.length > 0 && (
            <p className="tsum-handlers">
              Handled by: {summary.handlers.map(([who, n]) => `${who} (${n})`).join(", ")}
            </p>
          )}

          {summary.phases.map((group) => (
            <section key={group.phase} className="tsum-phase">
              <h4>{PHASE_LABEL[group.phase]} <span>{plural(group.milestones.length, "milestone")} · {plural(group.tasks, "task")}</span></h4>
              <ul>
                {group.milestones.map((m, i) => (
                  <li key={m.id ?? `${m.name}-${i}`}>
                    <details>
                      <summary>
                        <span>{m.name}</span>
                        <em>{plural(m.taskCount, "task")}</em>
                      </summary>
                      <ul className="tsum-tasks">
                        {m.taskList.filter(included).map((task, j) => (
                          <li key={task.id ?? `${task.name}-${j}`}>
                            {task.name}
                            {task.handledBy && <small>{task.handledBy}</small>}
                          </li>
                        ))}
                        {m.taskCount === 0 && <li className="tsum-none">No tasks yet</li>}
                      </ul>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="tsum-note">You can still add, remove or rename anything after the project is created.</p>
        </>
      )}
    </aside>
  );
}
