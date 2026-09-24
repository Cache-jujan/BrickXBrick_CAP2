import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createTicket } from "../../api/ticketsApi";
import { listProjects } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import "./CreateTicketPage.css";

const EMPTY_FORM = {
  projectID: "",
  ticketType: "Material Request",
  subject: "",
  description: "",
  materialType: "",
  quantity: "",
  vendorName: "",
};

export function CreateTicketPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listProjects("Active")
      .then((data) => {
        if (!cancelled) setProjects(data);
      })
      .catch((err) => {
        if (!cancelled) setProjectsError(extractErrorMessage(err, "Couldn't load active projects."));
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
    setFormError("");
  }

  function validate() {
    const errors = {};
    if (!form.projectID) errors.projectID = "Select a project.";
    if (!form.ticketType) errors.ticketType = "Select a ticket type.";
    if (!form.subject.trim()) errors.subject = "Subject is required.";

    if (form.ticketType === "Material Request" || form.ticketType === "Work Item") {
      if (!form.materialType.trim()) errors.materialType = "Material type is required.";
      if (form.quantity === "" || !Number.isFinite(Number(form.quantity)) || Number(form.quantity) <= 0) {
        errors.quantity = "Enter a quantity greater than 0.";
      }
      if (!form.vendorName.trim()) errors.vendorName = "Vendor name is required.";
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
      const ticket = await createTicket({
        projectID: form.projectID,
        ticketType: form.ticketType,
        subject: form.subject.trim(),
        description: form.description.trim() || undefined,
        ...(form.ticketType === "Material Request" || form.ticketType === "Work Item"
          ? {
              materialType: form.materialType.trim(),
              quantity: Number(form.quantity),
              vendorName: form.vendorName.trim(),
            }
          : {}),
      });
      navigate(`/dashboard/sm`, {
        replace: true,
        state: { successMessage: `Ticket “${ticket.subject}” was submitted.` },
      });
    } catch (err) {
      setFormError(extractErrorMessage(err, "Couldn't create the ticket. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="create-ticket">
      <Link to="/dashboard/sm" className="form-back-link">Back to Dashboard</Link>
      <h1 className="create-ticket-title">Create Ticket</h1>

      <Card className="create-ticket-card">
        <form onSubmit={handleSubmit} noValidate>
          {projectsError && <Banner tone="error" title={projectsError} />}

          <Field
            label="Project"
            as="select"
            required
            value={form.projectID}
            error={fieldErrors.projectID}
            disabled={projectsLoading || projects.length === 0}
            onChange={(e) => updateField("projectID", e.target.value)}
          >
            <option value="">{projectsLoading ? "Loading…" : "Select a project"}</option>
            {projects.map((project) => (
              <option key={project.projectid} value={project.projectid}>
                {project.name}
              </option>
            ))}
          </Field>

          <Field
            label="Ticket Type"
            as="select"
            required
            value={form.ticketType}
            error={fieldErrors.ticketType}
            onChange={(e) => updateField("ticketType", e.target.value)}
          >
            <option value="Material Request">Material Request</option>
            <option value="Work Item">Work Item</option>
            <option value="Report">Report</option>
          </Field>

          <Field
            label="Subject"
            required
            placeholder="Briefly describe the request"
            value={form.subject}
            error={fieldErrors.subject}
            onChange={(e) => updateField("subject", e.target.value)}
          />

          <Field
            label="Description / Context"
            as="textarea"
            placeholder="Add details about what is needed"
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
          />

          {(form.ticketType === "Material Request" || form.ticketType === "Work Item") && (
            <div className="create-ticket-procurement">
              <p className="create-ticket-section-label">Procurement details</p>
              <div className="create-ticket-row">
                <Field
                  label="Material Type"
                  required
                  placeholder="e.g. Cement"
                  value={form.materialType}
                  error={fieldErrors.materialType}
                  onChange={(e) => updateField("materialType", e.target.value)}
                />
                <Field
                  label="Quantity"
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0"
                  value={form.quantity}
                  error={fieldErrors.quantity}
                  onChange={(e) => updateField("quantity", e.target.value)}
                />
              </div>
              <Field
                label="Preferred Vendor"
                required
                placeholder="Enter vendor name"
                value={form.vendorName}
                error={fieldErrors.vendorName}
                onChange={(e) => updateField("vendorName", e.target.value)}
              />
            </div>
          )}

          {formError && <Banner tone="error" title={formError} />}

          <div className="create-ticket-actions">
            <Link to="/dashboard/sm" className="btn btn-secondary">Cancel</Link>
            <Button type="submit" disabled={submitting || projectsLoading || projects.length === 0}>
              {submitting ? "Submitting…" : "Submit Ticket"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
