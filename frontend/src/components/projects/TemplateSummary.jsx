import { useEffect, useRef, useState } from "react";
import { getCopySource, getProjectTemplate } from "../../api/projectTemplatesApi";
import { Button } from "../ui/Button";
import { BuildingGlyph, CheckSquareGlyph, FileGlyph, FlagGlyph, HelmetGlyph, LayersGlyph, WavesGlyph } from "../ui/glyphs";
import "./TemplateSummary.css";

const SIZE_LABEL = { small: "Small", large: "Large", custom: "Custom" };
const PHASE_LABEL = { Planning: "Pre-construction", Construction: "Construction" };

// Kept for the whole session, so opening the same template again is instant.
const cache = new Map();

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

// One icon per kind of work; anything new falls back to a neutral one.
export function CategoryIcon({ type, size = 24 }) {
  const name = String(type || "").toLowerCase();
  const Icon = /drain|flood|water/.test(name) ? WavesGlyph
    : /build|resid|commerc|house/.test(name) ? BuildingGlyph
    : /civil|road|bridge|work/.test(name) ? HelmetGlyph
    : LayersGlyph;
  return <Icon size={size} />;
}

/**
 * A pop-up with the details of the chosen template (or past project): what it contains, in which phase
 * and who handles it. `value` is the gallery's current choice; `template` is its card (description, size).
 */
export function TemplateSummaryDialog({ value, template, onClose, onUse }) {
  const [state, setState] = useState({ status: "loading", detail: null });
  const closeRef = useRef(null);
  const id = value?.mode === "template" ? value.templateId : value?.sourceProjectId;
  const key = `${value?.mode}:${id}`;

  useEffect(() => {
    if (cache.has(key)) {
      setState({ status: "ready", detail: cache.get(key) });
      return undefined;
    }
    let cancelled = false;
    setState({ status: "loading", detail: null });
    const load = value.mode === "template" ? getProjectTemplate(id) : getCopySource(id);
    load
      .then((detail) => {
        cache.set(key, detail);
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

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const summary = state.detail ? summarize(state.detail) : null;
  const size = template ? SIZE_LABEL[template.size] || template.size : null;
  const kind = [value.projectType, size, value.mode === "copy" ? "Past project" : "Template"].filter(Boolean).join(" · ");

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="tsum" role="dialog" aria-modal="true" aria-labelledby="tsum-title" onClick={(e) => e.stopPropagation()}>
        <header className="tsum-head">
          <span className="tsum-icon"><CategoryIcon type={value.projectType} size={26} /></span>
          <div className="tsum-head-text">
            <h2 id="tsum-title">{value.name}</h2>
            <p>{kind}</p>
          </div>
          <button ref={closeRef} type="button" className="tsum-close" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <div className="tsum-body" aria-live="polite">
          {template?.description && <p className="tsum-desc">{template.description}</p>}
          {state.status === "loading" && <p className="tsum-note">Loading the details…</p>}
          {state.status === "error" && <p className="tsum-note">The details could not be loaded. You can still continue.</p>}

          {summary && (
            <>
              <dl className="tsum-stats">
                <div><FlagGlyph size={22} /><dd>{summary.milestones}</dd><dt>milestones</dt></div>
                <div><CheckSquareGlyph size={22} /><dd>{summary.tasks}</dd><dt>tasks</dt></div>
                {summary.optional > 0 && <div><FileGlyph size={22} /><dd>{summary.optional}</dd><dt>optional documents</dt></div>}
                {summary.handlers.length > 0 && (
                  <div className="tsum-who">
                    <dt>Handled by</dt>
                    <dd>{summary.handlers.map(([who, n]) => `${who} (${n})`).join(", ")}</dd>
                  </div>
                )}
              </dl>

              <div className="tsum-phases">
                {summary.phases.map((group) => (
                  <section key={group.phase} className="tsum-phase">
                    <h3>{PHASE_LABEL[group.phase]} <span>{plural(group.milestones.length, "milestone")} · {plural(group.tasks, "task")}</span></h3>
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
              </div>
            </>
          )}
        </div>

        <footer className="tsum-foot">
          <p>Everything can still be added, removed or renamed after the project is created.</p>
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
          <Button type="button" onClick={onUse}>Use this {value.mode === "copy" ? "project" : "template"}</Button>
        </footer>
      </div>
    </div>
  );
}
