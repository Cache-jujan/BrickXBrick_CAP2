import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getEligibleManagers, getEligibleSiteManagers, getProjectOptions } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { Field } from "../ui/Field";
import { Button } from "../ui/Button";
import { Banner } from "../ui/Banner";
import { ManagerPicker } from "./ManagerPicker";

export const EMPTY_PROJECT_FORM = {
  name: "",
  description: "",
  clientName: "",
  budget: "",
  projectType: "",
  municipality: "",
  province: "Cebu",
  siteAddress: "",
  startDate: "",
  constructionStartDate: "",
  endDate: "",
  projectManagerId: "",
  siteManagerId: "",
};

// DATE columns arrive as timestamps of local midnight on the server
// (e.g. "2026-08-02T16:00:00.000Z" for Aug 3 in Manila). Slicing the string
// would give the previous day, so read the calendar date in local time.
function toDateInput(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Maps a project row from the API to form state (used by Edit Project).
export function projectToForm(project) {
  return {
    name: project.name || "",
    description: project.description || "",
    clientName: project.clientname || "",
    budget: project.budget != null ? String(Number(project.budget)) : "",
    projectType: project.projecttype || "",
    municipality: project.municipality || "",
    province: project.province || "",
    siteAddress: project.siteaddress || "",
    startDate: toDateInput(project.startdate),
    constructionStartDate: toDateInput(project.constructionstartdate),
    endDate: toDateInput(project.enddate),
    projectManagerId: project.projectmanagerid || "",
    siteManagerId: project.sitemanagerid || "",
  };
}

/**
 * Shared Create/Edit Project form (F2).
 *   mode="create": includes the optional Site Manager picker
 *   mode="edit":   the Site Manager is changed from the project page instead
 * onSubmit(payload) must return a promise; its rejection is shown as a banner.
 */
export function ProjectForm({ mode, projectId, initialValues, onSubmit, submitLabel, busyLabel, cancelTo, budgetLocked = false }) {
  const [form, setForm] = useState(initialValues || EMPTY_PROJECT_FORM);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [options, setOptions] = useState(null);
  const [managers, setManagers] = useState([]);
  const [siteManagers, setSiteManagers] = useState([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [listError, setListError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const requests = [getProjectOptions(), getEligibleManagers(projectId)];
    if (mode === "create") requests.push(getEligibleSiteManagers());
    Promise.all(requests)
      .then(([opts, pms, sms]) => {
        if (cancelled) return;
        setOptions(opts);
        setManagers(pms);
        setSiteManagers(sms || []);
      })
      .catch((err) => {
        if (!cancelled) setListError(extractErrorMessage(err, "Couldn't load the form options."));
      })
      .finally(() => {
        if (!cancelled) setLoadingLists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, projectId]);

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  const outsideServiceArea = Boolean(
    options &&
      form.municipality.trim() &&
      !options.serviceAreaMunicipalities.includes(normalizeMunicipality(form.municipality))
  );

  function validate() {
    const errors = {};
    if (!form.name.trim()) errors.name = "Project name is required.";
    if (!form.clientName.trim()) errors.clientName = "Client name is required.";
    if (form.budget === "" || Number(form.budget) < 0) errors.budget = "Enter a budget of 0 or more.";
    if (!form.projectType) errors.projectType = "Select the project type.";
    if (!form.municipality.trim()) errors.municipality = "Enter the municipality or city of the site.";
    if (!form.startDate) errors.startDate = "Target date of development is required.";
    if (!form.constructionStartDate) errors.constructionStartDate = "Target date of construction is required.";
    if (!form.endDate) errors.endDate = "Target date of completion is required.";
    if (form.startDate && form.constructionStartDate && form.constructionStartDate < form.startDate) {
      errors.constructionStartDate = "Construction can't start before development.";
    }
    if (form.constructionStartDate && form.endDate && form.endDate < form.constructionStartDate) {
      errors.endDate = "Completion can't be before construction starts.";
    }
    if (!form.projectManagerId) errors.projectManagerId = "Select a Project Manager.";
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

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      clientName: form.clientName.trim(),
      budget: Number(form.budget),
      projectType: form.projectType,
      municipality: form.municipality.trim(),
      province: form.province.trim(),
      siteAddress: form.siteAddress.trim(),
      startDate: form.startDate,
      constructionStartDate: form.constructionStartDate,
      endDate: form.endDate,
      projectManagerId: form.projectManagerId,
    };
    if (mode === "create" && form.siteManagerId) payload.siteManagerId = form.siteManagerId;

    setSubmitting(true);
    try {
      await onSubmit(payload);
    } catch (err) {
      setFormError(extractErrorMessage(err, "Couldn't save the project. Please try again."));
      setSubmitting(false);
    }
  }

  const availablePMs = managers.filter((m) => m.available || m.userid === initialValues?.projectManagerId);

  // Two columns on desktop: what the project is and where (left); money,
  // dates and people (right). Save/Cancel stays visible at the bottom.
  return (
    <form onSubmit={handleSubmit} noValidate className="pf-form">
      <div className="pf-grid">
        <div className="pf-col">
          <p className="create-project-section pf-first">Project</p>
          <Field
            label="Project Name"
            required
            placeholder="Enter project name"
            value={form.name}
            error={fieldErrors.name}
            onChange={(e) => updateField("name", e.target.value)}
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
              label="Project Type"
              as="select"
              required
              value={form.projectType}
              error={fieldErrors.projectType}
              disabled={!options}
              onChange={(e) => updateField("projectType", e.target.value)}
            >
              <option value="">{options ? "Select a project type" : "Loading…"}</option>
              {(options?.projectTypes || []).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Field>
          </div>
          <Field
            label="Project Description"
            as="textarea"
            className="pf-description"
            placeholder="Enter project description"
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
          />

          <p className="create-project-section">Site</p>
          <div className="create-project-row">
            <Field
              label="Municipality / City"
              required
              placeholder="e.g. Consolacion"
              value={form.municipality}
              error={fieldErrors.municipality}
              onChange={(e) => updateField("municipality", e.target.value)}
            />
            <Field
              label="Province"
              placeholder="e.g. Cebu"
              value={form.province}
              onChange={(e) => updateField("province", e.target.value)}
            />
          </div>
          <Field
            label="Site Address (optional)"
            placeholder="Street, barangay"
            value={form.siteAddress}
            onChange={(e) => updateField("siteAddress", e.target.value)}
          />
          {outsideServiceArea && (
            <Banner tone="warning" title="Outside the usual service area">
              Projects outside {options.serviceAreaMunicipalities.map(capitalize).join(", ")} are usually
              handled by a subcontractor. You can still create it.
            </Banner>
          )}
        </div>

        <div className="pf-col">
          <p className="create-project-section pf-first">Budget</p>
          <Field
            label="Target Budget in PHP"
            required
            type="number"
            min="0"
            step="any"
            placeholder="0"
            value={form.budget}
            error={fieldErrors.budget}
            disabled={budgetLocked}
            onChange={(e) => updateField("budget", e.target.value)}
          />
          <p className="field-hint">
            {budgetLocked
              ? "Follows the approved BOM total. Reopen the BOM to change it."
              : "The BOM total. It is set automatically when the BOM is approved."}
          </p>

          <p className="create-project-section">Timeline</p>
          <div className="create-project-row create-project-row-3">
            <Field
              label="Target Date of Development"
              required
              type="date"
              value={form.startDate}
              error={fieldErrors.startDate}
              onChange={(e) => updateField("startDate", e.target.value)}
            />
            <Field
              label="Target Date of Construction"
              required
              type="date"
              value={form.constructionStartDate}
              error={fieldErrors.constructionStartDate}
              onChange={(e) => updateField("constructionStartDate", e.target.value)}
            />
            <Field
              label="Target Date of Completion"
              required
              type="date"
              value={form.endDate}
              error={fieldErrors.endDate}
              onChange={(e) => updateField("endDate", e.target.value)}
            />
          </div>
          <p className="create-project-hint">
            Development covers planning, permits and procurement. The project stays in Draft until it is activated.
          </p>

          <p className="create-project-section">Team</p>
          {listError && <Banner tone="error" title={listError} />}
          {!loadingLists && !listError && availablePMs.length === 0 && (
            <Banner tone="warning" title="No Project Manager is available">
              Every Project Manager already has the maximum number of open projects. Complete or cancel one
              of their projects first, or ask the System Administrator to create another Project Manager account.
            </Banner>
          )}
          <ManagerPicker
            label="Project Manager"
            required
            managers={managers}
            loading={loadingLists}
            value={form.projectManagerId}
            currentId={initialValues?.projectManagerId}
            error={fieldErrors.projectManagerId}
            emptyOptionLabel="Select a Project Manager"
            onChange={(v) => updateField("projectManagerId", v)}
          />

          {mode === "create" && (
            <ManagerPicker
              label="Site Manager (required before activation)"
              managers={siteManagers}
              loading={loadingLists}
              value={form.siteManagerId}
              emptyOptionLabel="None yet (assign later)"
              onChange={(v) => updateField("siteManagerId", v)}
            />
          )}
        </div>
      </div>

      <div className="pf-actions">
        {formError ? <Banner tone="error" title={formError} /> : <span className="pf-actions-note">Fields marked * are required.</span>}
        <div className="pf-actions-buttons">
          <Link to={cancelTo} className="btn btn-secondary">
            Cancel
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? busyLabel : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

// Mirrors normalizeMunicipality in backend/src/lib/projectRules.js.
function normalizeMunicipality(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(city|municipality) of /, "")
    .replace(/ (city|municipality)$/, "")
    .trim();
}

function capitalize(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
