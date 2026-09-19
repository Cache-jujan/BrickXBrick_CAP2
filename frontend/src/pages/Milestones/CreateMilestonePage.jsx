import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { createMilestone } from "../../api/milestonesApi";
import { extractErrorMessage } from "../../api/client";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import "./CreateMilestonePage.css";

const EMPTY_FORM = { name: "", dueDate: "" };

export function CreateMilestonePage() {
  const { id: projectId } = useParams();
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
    if (!form.name.trim()) errors.name = "Milestone name is required.";
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
      // milestones.js destructures projectID (capital ID) off req.body.
      await createMilestone({
        projectID: projectId,
        name: form.name.trim(),
        dueDate: form.dueDate,
      });
      navigate(`/projects/${projectId}`, { replace: true });
    } catch (err) {
      setFormError(extractErrorMessage(err, "Couldn't create the milestone. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="create-milestone">
      <h1 className="create-milestone-title">Add Milestone</h1>

      <Card className="create-milestone-card">
        <form onSubmit={handleSubmit} noValidate>
          <Field
            label="Milestone Name"
            required
            placeholder="Enter milestone name"
            value={form.name}
            error={fieldErrors.name}
            onChange={(e) => updateField("name", e.target.value)}
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

          <div className="create-milestone-actions">
            <Link to={`/projects/${projectId}`} className="btn btn-secondary">
              Cancel
            </Link>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding…" : "Add Milestone"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
