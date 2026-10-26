import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { createMilestone } from "../../api/milestonesApi";
import { extractErrorMessage } from "../../api/client";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import "./CreateMilestonePage.css";
import { BackLink } from "../../components/ui/BackLink";
import { useLocale } from "../../i18n/LocaleProvider";

const EMPTY_FORM = { name: "", dueDate: "" };

export function CreateMilestonePage() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const { t } = useLocale();
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate() {
    const errors = {};
    if (!form.name.trim()) errors.name = t("ms.err_name");
    if (!form.dueDate) errors.dueDate = t("ms.err_due");
    return errors;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      // milestones.js destructures projectID (capital ID) off req.body.
      await createMilestone({
        projectID: projectId,
        name: form.name.trim(),
        dueDate: form.dueDate,
      });
      navigate(`/projects/${projectId}`, { replace: true });
    } catch (err) {
      setFormError(extractErrorMessage(err, t("errors.create_milestone")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="create-milestone">
      <BackLink to={`/projects/${projectId}`}>{t("projects.back_one")}</BackLink>
      <h1 className="create-milestone-title">{t("pd.add_milestone_btn")}</h1>

      <Card className="create-milestone-card">
        <form onSubmit={handleSubmit} noValidate>
          <Field
            label={t("pd.milestone_name")}
            required
            placeholder={t("pd.milestone_ph")}
            value={form.name}
            error={fieldErrors.name}
            onChange={(e) => updateField("name", e.target.value)}
          />

          <Field
            label={t("mobile.due_date")}
            required
            type="date"
            value={form.dueDate}
            error={fieldErrors.dueDate}
            onChange={(e) => updateField("dueDate", e.target.value)}
          />

          {formError && <Banner tone="error" title={formError} />}

          <div className="create-milestone-actions">
            <Link to={`/projects/${projectId}`} className="btn btn-secondary">
              {t("common.cancel")}
            </Link>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("pd.adding") : t("pd.add_milestone_btn")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
