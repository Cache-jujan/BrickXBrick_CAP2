import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { createTask } from "../../api/tasksApi";
import { extractErrorMessage } from "../../api/client";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import "./CreateTaskPage.css";
import { BackLink } from "../../components/ui/BackLink";
import { useLocale } from "../../i18n/LocaleProvider";

const EMPTY_FORM = { taskName: "", dueDate: "" };

export function CreateTaskPage() {
  const { id: projectId, milestoneId } = useParams();
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
    if (!form.taskName.trim()) errors.taskName = t("ms.err_task_name");
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
      await createTask(milestoneId, {
        taskName: form.taskName.trim(),
        dueDate: form.dueDate,
      });
      navigate(`/projects/${projectId}`, { replace: true });
    } catch (err) {
      setFormError(extractErrorMessage(err, t("errors.create_task")));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="create-task">
      <BackLink to={`/projects/${projectId}`}>{t("projects.back_one")}</BackLink>
      <h1 className="create-task-title">{t("pd.add_task_btn")}</h1>
      <p className="create-task-subtitle">{t("pd.task_auto_help")}</p>

      <Card className="create-task-card">
        <form onSubmit={handleSubmit} noValidate>
          <Field
            label={t("pd.task_name")}
            required
            placeholder={t("pd.task_ph")}
            value={form.taskName}
            error={fieldErrors.taskName}
            onChange={(e) => updateField("taskName", e.target.value)}
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

          <div className="create-task-actions">
            <Link to={`/projects/${projectId}`} className="btn btn-secondary">
              {t("common.cancel")}
            </Link>
            <Button type="submit" disabled={submitting}>
              {submitting ? t("pd.adding") : t("pd.add_task_btn")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
