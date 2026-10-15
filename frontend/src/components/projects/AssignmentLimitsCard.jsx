import { useEffect, useState } from "react";
import { getAssignmentLimits, updateAssignmentLimits } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import "./AssignmentLimitsCard.css";

const MIN = 1;
const MAX = 10;

const plural = (n) => `${n} open project${n === 1 ? "" : "s"}`;

/**
 * F2 — how many open (Draft/Active) projects a Project Manager and a Site
 * Manager may hold at once (adviser item 4). It's the client's policy, so the
 * General Manager can change it here without a code change. Lowering a limit
 * never removes anyone from a project; it only blocks new assignments.
 */
export function AssignmentLimitsCard() {
  const [limits, setLimits] = useState(null);
  const [draft, setDraft] = useState({ pm: "", sm: "" });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getAssignmentLimits()
      .then(setLimits)
      .catch((err) => setError(extractErrorMessage(err, "Couldn't load the assignment limits.")));
  }, []);

  function startEdit() {
    setDraft({ pm: String(limits.pm), sm: String(limits.sm) });
    setError("");
    setSaved(false);
    setEditing(true);
  }

  const pm = Number(draft.pm);
  const sm = Number(draft.sm);
  const valid = [pm, sm].every((n) => Number.isInteger(n) && n >= MIN && n <= MAX);
  const changed = limits && (pm !== limits.pm || sm !== limits.sm);

  async function handleSave(e) {
    e.preventDefault();
    if (!valid || !changed) return;
    setBusy(true);
    setError("");
    try {
      setLimits(await updateAssignmentLimits({ pm, sm }));
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't save the assignment limits."));
    } finally {
      setBusy(false);
    }
  }

  if (!limits) {
    return error ? <Banner tone="error" title={error} /> : null;
  }

  return (
    <section className="limits-card" aria-label="Assignment limits">
      {!editing ? (
        <div className="limits-row">
          <p className="limits-text">
            <span className="limits-label">Assignment limits</span>
            Project Manager: <strong>{plural(limits.pm)}</strong> at a time
            <span className="limits-sep" aria-hidden="true">·</span>
            Site Manager: <strong>{plural(limits.sm)}</strong> at a time
          </p>
          <Button variant="secondary" className="btn-sm" onClick={startEdit}>
            Edit limits
          </Button>
        </div>
      ) : (
        <form className="limits-form" onSubmit={handleSave} noValidate>
          <Field
            label="Project Manager"
            type="number"
            min={MIN}
            max={MAX}
            step={1}
            value={draft.pm}
            onChange={(e) => setDraft((d) => ({ ...d, pm: e.target.value }))}
            error={draft.pm !== "" && !(Number.isInteger(pm) && pm >= MIN && pm <= MAX) ? `${MIN} to ${MAX}` : ""}
          />
          <Field
            label="Site Manager"
            type="number"
            min={MIN}
            max={MAX}
            step={1}
            value={draft.sm}
            onChange={(e) => setDraft((d) => ({ ...d, sm: e.target.value }))}
            error={draft.sm !== "" && !(Number.isInteger(sm) && sm >= MIN && sm <= MAX) ? `${MIN} to ${MAX}` : ""}
          />
          <p className="limits-hint">
            How many open (Draft or Active) projects each person may hold at a time, from {MIN} to {MAX}.
            Lowering a limit doesn&apos;t remove anyone from their projects. It only stops new assignments
            until they&apos;re under the limit.
          </p>
          <div className="limits-actions">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !valid || !changed}>
              {busy ? "Saving…" : "Save limits"}
            </Button>
          </div>
        </form>
      )}
      {error && <Banner tone="error" title={error} />}
      {saved && !editing && <p className="limits-saved">Saved. New assignments follow these limits.</p>}
    </section>
  );
}
