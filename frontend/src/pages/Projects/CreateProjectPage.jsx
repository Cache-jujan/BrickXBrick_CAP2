import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { createProject, getEligibleManagers } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import "./CreateProjectPage.css";

const EMPTY_FORM = {
  name: "",
  description: "",
  clientName: "",
  budget: "",
  startDate: "",
  endDate: "",
  projectManagerId: "",
};

export function CreateProjectPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [managers, setManagers] = useState([]);
  const [managersLoading, setManagersLoading] = useState(true);
  const [managersError, setManagersError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getEligibleManagers()
      .then((data) => {
        if (!cancelled) setManagers(data);
      })
      .catch((err) => {
        if (!cancelled) setManagersError(extractErrorMessage(err, "Couldn't load Project Managers."));
      })
      .finally(() => {
        if (!cancelled) setManagersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate() {
    const errors = {};
    if (!form.name.trim()) errors.name = "Project name is required.";
    if (!form.clientName.trim()) errors.clientName = "Client name is required.";
    if (!form.startDate) errors.startDate = "Start date is required.";
    if (form.budget === "" || Number(form.budget) < 0) {
      errors.budget = "Enter a budget of 0 or more.";
    }
    if (form.endDate && form.startDate && form.endDate < form.startDate) {
      errors.endDate = "End date can't be before the start date.";
    }
    if (!form.projectManagerId) {
      errors.projectManagerId = "Select a Project Manager.";
    }
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
      const project = await createProject({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        clientName: form.clientName.trim(),
        budget: Number(form.budget),
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        projectManagerId: form.projectManagerId,
      });
      navigate(`/projects/${project.projectid}`, { replace: true });
    } catch (err) {
      setFormError(extractErrorMessage(err, "Couldn't create the project. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="create-project">
      <Link to="/projects" className="form-back-link">Back to Projects</Link>
      <h1 className="create-project-title">Create New Project</h1>

      <Card className="create-project-card">
        <form onSubmit={handleSubmit} noValidate>
          <Field
            label="Project Name"
            required
            placeholder="Enter project name"
            value={form.name}
            error={fieldErrors.name}
            onChange={(e) => updateField("name", e.target.value)}
          />

          <Field
            label="Project Description"
            as="textarea"
            placeholder="Enter project description"
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
          />

          <div className="create-project-row">
            <Field
              label="Client Name"
              required
              placeholder="Enter client name"
              value={form.clientName}
              error={fieldErrors.clientName}
              onChange={(e) => updateField("clientName", e.target.value)}
            />
            <Field
              label="Target Budget in PHP"
              required
              type="number"
              min="0"
              step="1000"
              placeholder="0"
              value={form.budget}
              error={fieldErrors.budget}
              onChange={(e) => updateField("budget", e.target.value)}
            />
          </div>

          {managersError && <Banner tone="error" title={managersError} />}

          {!managersLoading && !managersError && managers.length === 0 && (
            <Banner tone="warning" title="No Project Managers available">
              Create a Project Manager account first (System Administrator, User Accounts) before starting a new project.
            </Banner>
          )}

          <Field
            label="Project Manager"
            as="select"
            required
            value={form.projectManagerId}
            error={fieldErrors.projectManagerId}
            disabled={managersLoading || managers.length === 0}
            onChange={(e) => updateField("projectManagerId", e.target.value)}
          >
            <option value="">
              {managersLoading ? "Loading…" : "Select a Project Manager"}
            </option>
            {managers.map((m) => (
              <option key={m.userid} value={m.userid}>
                {m.name.trim()} ({m.email})
              </option>
            ))}
          </Field>

          <div className="create-project-row">
            <Field
              label="Start Date"
              required
              type="date"
              value={form.startDate}
              error={fieldErrors.startDate}
              onChange={(e) => updateField("startDate", e.target.value)}
            />
            <Field
              label="Expected End Date"
              type="date"
              value={form.endDate}
              error={fieldErrors.endDate}
              onChange={(e) => updateField("endDate", e.target.value)}
            />
          </div>

          {formError && <Banner tone="error" title={formError} />}

          <div className="create-project-actions">
            <Link to="/projects" className="btn btn-secondary">
              Cancel
            </Link>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create Project"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
