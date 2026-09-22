import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { createTask } from "../../api/tasksApi";
import { extractErrorMessage } from "../../api/client";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import "./CreateTaskPage.css";

const EMPTY_FORM = { taskName: "", dueDate: "" };

export function CreateTaskPage() {
  const { id: projectId, milestoneId } = useParams();
  const navigate = useNavigate();
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
    if (!form.taskName.trim()) errors.taskName = "Task Name is required.";
    if (!form.dueDate) errors.dueDate = "Due date is required.";
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
      setFormError(extractErrorMessage(err, "Couldn't create the task. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="create-task">
      <Link to={`/projects/${projectId}`} className="form-back-link">Back to project</Link>
      <h1 className="create-task-title">Add Task</h1>
      <p className="create-task-subtitle">
        Assigned automatically to this project's Site Manager.
      </p>

      <Card className="create-task-card">
        <form onSubmit={handleSubmit} noValidate>
          <Field
            label="Task Name"
            required
            placeholder="Enter task name"
            value={form.taskName}
            error={fieldErrors.taskName}
            onChange={(e) => updateField("taskName", e.target.value)}
          />

          <Field
            label="Due Date"
            required
            type="date"
            value={form.dueDate}
            error={fieldErrors.dueDate}
            onChange={(e) => updateField("dueDate", e.target.value)}
          />

          {formError && <Banner tone="error" title={formError} />}

          <div className="create-task-actions">
            <Link to={`/projects/${projectId}`} className="btn btn-secondary">
              Cancel
            </Link>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding…" : "Add Task"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
