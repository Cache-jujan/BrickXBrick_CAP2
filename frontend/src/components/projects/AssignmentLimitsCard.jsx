import { useEffect, useState } from "react";
import { getAssignmentLimits, updateAssignmentLimits } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { useLocale } from "../../i18n/LocaleProvider";
import "./AssignmentLimitsCard.css";

const MIN = 1;
const MAX = 10;

/**
 * F2 — how many open (Draft/Active) projects a Project Manager and a Site
 * Manager may hold at once (adviser item 4). It's the client's policy, so the
 * General Manager can change it here without a code change. Lowering a limit
 * never removes anyone from a project; it only blocks new assignments.
 */
export function AssignmentLimitsCard() {
  const { t } = useLocale();
  const plural = (n) => t(n === 1 ? "limits.plural_one" : "limits.plural_other", { count: n });
  const [limits, setLimits] = useState(null);
  const [draft, setDraft] = useState({ pm: "", sm: "" });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getAssignmentLimits()
      .then(setLimits)
      .catch((err) => setError(extractErrorMessage(err, t("errors.load_limits"))));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; a language change must not refetch
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
      setError(extractErrorMessage(err, t("errors.save_limits")));
    } finally {
      setBusy(false);
    }
  }

  if (!limits) {
    return error ? <Banner tone="error" title={error} /> : null;
  }

  return (
    <section className="limits-card" aria-label={t("limits.title")}>
      {!editing ? (
        <div className="limits-row">
          <p className="limits-text">
            <span className="limits-label">{t("limits.title")}</span>
            Project Manager: <strong>{plural(limits.pm)}</strong> {t("limits.at_a_time")}
            <span className="limits-sep" aria-hidden="true">·</span>
            Site Manager: <strong>{plural(limits.sm)}</strong> {t("limits.at_a_time")}
          </p>
          <Button variant="secondary" className="btn-sm" onClick={startEdit}>
            {t("limits.edit")}
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
            error={draft.pm !== "" && !(Number.isInteger(pm) && pm >= MIN && pm <= MAX) ? t("limits.range", { min: MIN, max: MAX }) : ""}
          />
          <Field
            label="Site Manager"
            type="number"
            min={MIN}
            max={MAX}
            step={1}
            value={draft.sm}
            onChange={(e) => setDraft((d) => ({ ...d, sm: e.target.value }))}
            error={draft.sm !== "" && !(Number.isInteger(sm) && sm >= MIN && sm <= MAX) ? t("limits.range", { min: MIN, max: MAX }) : ""}
          />
          <p className="limits-hint">{t("limits.hint", { min: MIN, max: MAX })}</p>
          <div className="limits-actions">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !valid || !changed}>
              {busy ? t("common.saving") : t("limits.save")}
            </Button>
          </div>
        </form>
      )}
      {error && <Banner tone="error" title={error} />}
      {saved && !editing && <p className="limits-saved">{t("limits.saved")}</p>}
    </section>
  );
}
