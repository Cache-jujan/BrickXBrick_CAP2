import { useEffect, useMemo, useState } from "react";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { extractErrorMessage } from "../../api/client";
import { getTimelineLocks, updateTimeline } from "../../api/milestonesApi";
import "./EditTimelineModal.css";

// The PM's "Edit timeline": one simple list of the project's milestones and
// tasks, numbered, each with its due date beside it. Rename, re-date or delete,
// then Save once. The backend applies everything in one transaction (or none of
// it), and is the real enforcement point for the rules shown here:
//   - a completed task is locked
//   - a task with a progress submission or documents can't be deleted
//   - a milestone can only be deleted if all of its tasks can be

const LOCK_TEXT = {
  progress: "has a progress submission",
  documents: "has documents attached",
};

// Same convention as ProjectTimeline: the API sends dates as ISO text and the
// first ten characters are the calendar day.
function dateOnly(value) {
  return String(value ?? "").slice(0, 10);
}

function byDueDate(a, b) {
  return dateOnly(a.duedate).localeCompare(dateOnly(b.duedate));
}

// Pre-construction milestones first, then Construction, each by due date, with
// each milestone's tasks by due date: the order the timeline itself shows.
function buildRows(project) {
  const milestones = Array.isArray(project?.milestones) ? project.milestones : [];
  const planning = milestones.filter((m) => m.phase === "Planning").sort(byDueDate);
  const construction = milestones.filter((m) => m.phase !== "Planning").sort(byDueDate);
  return [...planning, ...construction].map((m) => ({
    id: m.milestoneid,
    phase: m.phase === "Planning" ? "Planning" : "Construction",
    name: m.name || "",
    dueDate: dateOnly(m.duedate),
    original: { name: m.name || "", dueDate: dateOnly(m.duedate) },
    removed: false,
    tasks: [...(m.tasks || [])].sort(byDueDate).map((t) => ({
      id: t.taskid,
      name: t.taskname || "",
      dueDate: dateOnly(t.duedate),
      original: { name: t.taskname || "", dueDate: dateOnly(t.duedate) },
      status: t.status,
      removed: false,
    })),
  }));
}

const PHASE_LABEL = { Planning: "Pre-construction", Construction: "Construction" };

export function EditTimelineModal({ project, onClose, onSaved }) {
  const [rows, setRows] = useState(() => buildRows(project));
  const [locks, setLocks] = useState(null); // null while loading
  const [locksFailed, setLocksFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [problems, setProblems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    getTimelineLocks(project.projectid)
      .then((data) => { if (!cancelled) setLocks(data.locks || {}); })
      .catch(() => {
        // The server checks again on save, so the PM is not blocked here.
        if (!cancelled) { setLocks({}); setLocksFailed(true); }
      });
    return () => { cancelled = true; };
  }, [project.projectid]);

  // Why a task can't be deleted, or null.
  function taskBlocker(task) {
    if (task.status === "Completed") return "is completed";
    const lock = locks && locks[task.id];
    return lock ? LOCK_TEXT[lock] : null;
  }

  // The first reason a milestone can't be deleted, or null.
  function milestoneBlocker(milestone) {
    for (const task of milestone.tasks) {
      const why = taskBlocker(task);
      if (why) return `The task "${task.name}" ${why}.`;
    }
    return null;
  }

  // What the Save button would send, plus what is wrong with the form.
  const summary = useMemo(() => {
    const milestones = [];
    const tasks = [];
    const invalid = {};
    let changed = 0;
    let deletions = 0;

    for (const m of rows) {
      if (m.removed) {
        milestones.push({ milestoneID: m.id, remove: true });
        changed += 1;
        deletions += 1 + m.tasks.length;
        continue;
      }
      const name = m.name.trim();
      if (!name) invalid[m.id] = "Give this milestone a name.";
      else if (!m.dueDate) invalid[m.id] = "Pick a due date.";
      else {
        const entry = { milestoneID: m.id };
        if (name !== m.original.name) entry.name = name;
        if (m.dueDate !== m.original.dueDate) entry.dueDate = m.dueDate;
        if (entry.name !== undefined || entry.dueDate !== undefined) {
          milestones.push(entry);
          changed += 1;
        }
      }

      for (const t of m.tasks) {
        if (t.removed) {
          tasks.push({ taskID: t.id, remove: true });
          changed += 1;
          deletions += 1;
          continue;
        }
        const taskName = t.name.trim();
        if (!taskName) invalid[t.id] = "Give this task a name.";
        else if (!t.dueDate) invalid[t.id] = "Pick a due date.";
        else {
          const entry = { taskID: t.id };
          if (taskName !== t.original.name) entry.taskName = taskName;
          if (t.dueDate !== t.original.dueDate) entry.dueDate = t.dueDate;
          if (entry.taskName !== undefined || entry.dueDate !== undefined) {
            tasks.push(entry);
            changed += 1;
          }
        }
      }
    }
    return { payload: { milestones, tasks }, changed, deletions, invalid, hasInvalid: Object.keys(invalid).length > 0 };
  }, [rows]);

  const canSave = !busy && summary.changed > 0 && !summary.hasInvalid;

  function patchMilestone(id, patch) {
    setRows((current) => current.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function patchTask(milestoneId, taskId, patch) {
    setRows((current) =>
      current.map((m) =>
        m.id !== milestoneId ? m : { ...m, tasks: m.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)) }
      )
    );
  }

  function requestClose() {
    if (busy) return;
    if (summary.changed > 0 && !window.confirm("Discard your changes?")) return;
    onClose();
  }

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") requestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function handleSave() {
    if (!canSave) return;
    setBusy(true);
    setError("");
    setProblems([]);
    try {
      const result = await updateTimeline({ projectID: project.projectid, ...summary.payload });
      await onSaved(result); // the page closes this dialog and reloads the project
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't save the timeline. Please try again."));
      setProblems(err?.response?.data?.details?.errors || []);
      setBusy(false);
    }
  }

  let lastPhase = null;

  return (
    <div className="modal-overlay" role="presentation" onClick={requestClose}>
      <div
        className="modal edit-timeline"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-timeline-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 id="edit-timeline-title" className="modal-title">Edit timeline</h2>
        <p className="modal-body">
          Rename, change a due date, or delete. Nothing is saved until you press Save.
        </p>

        {locksFailed && (
          <Banner tone="warning" title="Couldn't check which tasks can be deleted. The server will check when you save." />
        )}

        {rows.length === 0 ? (
          <p className="modal-body">This project has no milestones yet.</p>
        ) : (
          <ol className="et-list">
            {rows.map((m, mi) => {
              const showPhase = m.phase !== lastPhase;
              lastPhase = m.phase;
              const blocker = locks ? milestoneBlocker(m) : null;
              const mNumber = mi + 1;
              return (
                <li key={m.id} className={`et-milestone${m.removed ? " et-removed" : ""}`}>
                  {showPhase && <div className="et-phase">{PHASE_LABEL[m.phase]}</div>}
                  <div className="et-row et-row-milestone">
                    <span className="et-num">{mNumber}</span>
                    <input
                      className="field-control et-name"
                      aria-label={`Milestone ${mNumber} name`}
                      value={m.name}
                      disabled={busy || m.removed}
                      maxLength={150}
                      onChange={(ev) => patchMilestone(m.id, { name: ev.target.value })}
                    />
                    <input
                      className="field-control et-date"
                      type="date"
                      aria-label={`Milestone ${mNumber} due date`}
                      value={m.dueDate}
                      disabled={busy || m.removed}
                      onChange={(ev) => patchMilestone(m.id, { dueDate: ev.target.value })}
                    />
                    <div className="et-action">
                      {m.removed ? (
                        <button type="button" className="et-link" disabled={busy} onClick={() => patchMilestone(m.id, { removed: false })}>Undo</button>
                      ) : (
                        <button
                          type="button"
                          className="et-link et-link-danger"
                          disabled={busy || !locks || Boolean(blocker)}
                          title={blocker ? `Can't delete: ${blocker}` : "Delete this milestone and its tasks"}
                          onClick={() => patchMilestone(m.id, { removed: true })}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  {summary.invalid[m.id] && <p className="et-error">{summary.invalid[m.id]}</p>}
                  {blocker && !m.removed && <p className="et-hint">Can't be deleted: {blocker}</p>}
                  {m.removed && <p className="et-hint">Will be deleted with {m.tasks.length === 1 ? "its task" : `its ${m.tasks.length} tasks`}.</p>}

                  {m.tasks.length > 0 && (
                    <ol className="et-tasks">
                      {m.tasks.map((t, ti) => {
                        const tNumber = `${mNumber}.${ti + 1}`;
                        const completed = t.status === "Completed";
                        const why = locks ? taskBlocker(t) : null;
                        const goneWithMilestone = m.removed;
                        return (
                          <li key={t.id} className={`et-task${t.removed || goneWithMilestone ? " et-removed" : ""}`}>
                            <div className="et-row">
                              <span className="et-num">{tNumber}</span>
                              <input
                                className="field-control et-name"
                                aria-label={`Task ${tNumber} name`}
                                value={t.name}
                                disabled={busy || completed || t.removed || goneWithMilestone}
                                maxLength={150}
                                onChange={(ev) => patchTask(m.id, t.id, { name: ev.target.value })}
                              />
                              <input
                                className="field-control et-date"
                                type="date"
                                aria-label={`Task ${tNumber} due date`}
                                value={t.dueDate}
                                disabled={busy || completed || t.removed || goneWithMilestone}
                                onChange={(ev) => patchTask(m.id, t.id, { dueDate: ev.target.value })}
                              />
                              <div className="et-action">
                                {completed ? (
                                  <span className="et-pill">Completed</span>
                                ) : goneWithMilestone ? null : t.removed ? (
                                  <button type="button" className="et-link" disabled={busy} onClick={() => patchTask(m.id, t.id, { removed: false })}>Undo</button>
                                ) : (
                                  <button
                                    type="button"
                                    className="et-link et-link-danger"
                                    disabled={busy || !locks || Boolean(why)}
                                    title={why ? `Can't delete: this task ${why}` : "Delete this task"}
                                    onClick={() => patchTask(m.id, t.id, { removed: true })}
                                  >
                                    Delete
                                  </button>
                                )}
                              </div>
                            </div>
                            {summary.invalid[t.id] && <p className="et-error">{summary.invalid[t.id]}</p>}
                            {!completed && why && !t.removed && <p className="et-hint">Can't be deleted: it {why}. You can still rename it or change its date.</p>}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {summary.deletions > 0 && (
          <Banner tone="warning" title={`${summary.deletions} item${summary.deletions === 1 ? "" : "s"} will be deleted when you save. This can't be undone.`} />
        )}
        {error && (
          <Banner tone="error" title={error}>
            {problems.length > 0 && (
              <ul className="et-problems">
                {problems.map((p) => <li key={`${p.type}-${p.id}`}>{p.message}</li>)}
              </ul>
            )}
          </Banner>
        )}

        <div className="modal-actions">
          <span className="et-count">
            {summary.changed === 0 ? "No changes yet" : `${summary.changed} change${summary.changed === 1 ? "" : "s"}`}
          </span>
          <Button variant="secondary" onClick={requestClose} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}
