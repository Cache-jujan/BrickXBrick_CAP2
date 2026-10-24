import { useMemo } from "react";
import "./DocumentChecklist.css";

// Which tasks a template/past project starts with. Used on the second screen of
// "New project": the GM unticks what this job doesn't need.
//
// Template: only permit documents have a checkbox (standard ones start ticked,
// "only if it applies" ones start unticked). All other template tasks are always
// created. Copy: every task has a checkbox, all ticked.
//
// selection: { included: Set<id>, excluded: Set<id> }  (task ids from the API)
export const EMPTY_SELECTION = { included: new Set(), excluded: new Set() };

export function isChecked(task, selection) {
  if (selection.excluded.has(task.id)) return false;
  return task.defaultIncluded || selection.included.has(task.id);
}

export function withChecked(selection, task, checked) {
  const included = new Set(selection.included);
  const excluded = new Set(selection.excluded);
  if (task.defaultIncluded) {
    if (checked) excluded.delete(task.id);
    else excluded.add(task.id);
  } else if (checked) {
    included.add(task.id);
  } else {
    included.delete(task.id);
  }
  return { included, excluded };
}

// The part of the create/preview request that carries the GM's choices.
export function selectionToStart(base, selection) {
  const out = { ...base, excludeTaskIds: [...selection.excluded] };
  if (base.mode === "template") out.includeTaskIds = [...selection.included];
  return out;
}

const OWNER = { GM: "General Manager", PM: "Project Manager" };

export function DocumentChecklist({ source, selection, onChange }) {
  const isCopy = source.kind === "copy";

  const { standard, conditional, fixedCount } = useMemo(() => {
    const docs = source.milestones.flatMap((m) => m.tasks).filter((t) => t.selectable);
    return {
      standard: docs.filter((t) => t.defaultIncluded),
      conditional: docs.filter((t) => !t.defaultIncluded),
      fixedCount: source.milestones.flatMap((m) => m.tasks).filter((t) => !t.selectable).length,
    };
  }, [source]);

  function toggle(task, checked) {
    onChange(withChecked(selection, task, checked));
  }

  function setMilestone(milestone, checked) {
    let next = selection;
    for (const t of milestone.tasks) next = withChecked(next, t, checked);
    onChange(next);
  }

  if (isCopy) {
    const all = source.milestones.flatMap((m) => m.tasks);
    const on = all.filter((t) => isChecked(t, selection)).length;
    return (
      <section className="dc" aria-labelledby="dc-title">
        <h2 id="dc-title" className="dc-title">Tasks to copy from "{source.name}"</h2>
        <p className="dc-sub">
          {on} of {all.length} selected. Untick anything this project doesn't need. A milestone with no tasks left is not created.
        </p>
        {source.milestones.map((m) => {
          const ticked = m.tasks.filter((t) => isChecked(t, selection)).length;
          return (
            <fieldset key={m.id} className="dc-group">
              <legend className="dc-legend">
                <label>
                  <input
                    type="checkbox"
                    checked={ticked === m.tasks.length && m.tasks.length > 0}
                    ref={(el) => { if (el) el.indeterminate = ticked > 0 && ticked < m.tasks.length; }}
                    onChange={(e) => setMilestone(m, e.target.checked)}
                  />
                  <strong>{m.name}</strong>
                  <span className="dc-phase">{m.phase}</span>
                </label>
              </legend>
              <ul className="dc-list">
                {m.tasks.map((t) => (
                  <Row key={t.id} task={t} checked={isChecked(t, selection)} onToggle={toggle} />
                ))}
              </ul>
            </fieldset>
          );
        })}
      </section>
    );
  }

  const onCount = [...standard, ...conditional].filter((t) => isChecked(t, selection)).length;
  return (
    <section className="dc" aria-labelledby="dc-title">
      <h2 id="dc-title" className="dc-title">Documents to include</h2>
      <p className="dc-sub">
        Each ticked document becomes a task with its own due date. Untick the ones this project doesn't need;
        you can add a task later from the project page. {onCount} selected.
        {fixedCount > 0 && ` ${fixedCount} other tasks from the template are always included.`}
      </p>

      <fieldset className="dc-group">
        <legend className="dc-legend"><strong>Standard permit documents</strong></legend>
        <ul className="dc-list">
          {standard.map((t) => <Row key={t.id} task={t} checked={isChecked(t, selection)} onToggle={toggle} />)}
        </ul>
      </fieldset>

      {conditional.length > 0 && (
        <fieldset className="dc-group">
          <legend className="dc-legend"><strong>Only if it applies</strong></legend>
          <ul className="dc-list">
            {conditional.map((t) => <Row key={t.id} task={t} checked={isChecked(t, selection)} onToggle={toggle} />)}
          </ul>
        </fieldset>
      )}
    </section>
  );
}

function Row({ task, checked, onToggle }) {
  return (
    <li className="dc-row">
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(task, e.target.checked)} />
        <span className="dc-name">{task.name}</span>
        {task.handledBy && <span className="dc-owner">{OWNER[task.handledBy]}</span>}
      </label>
      {task.hint && <p className="dc-hint">{task.hint}</p>}
    </li>
  );
}
