import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getEligibleManagers, getEligibleSiteManagers, getProjectOptions } from "../../api/projectsApi";
import { extractErrorMessage } from "../../api/client";
import { Field } from "../ui/Field";
import { Button } from "../ui/Button";
import { Banner } from "../ui/Banner";
import { ManagerPicker } from "./ManagerPicker";
import { useLocale } from "../../i18n/LocaleProvider";
import { formatAmountInput, parseAmountInput } from "../../utils/amountInput";

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
 * onSubmit(payload, form) must return a promise; its rejection is shown as a
 * banner. `form` is the raw field state, so a wizard can bring the user back.
 */
export function ProjectForm({
  mode,
  projectId,
  initialValues,
  onSubmit,
  submitLabel,
  busyLabel,
  cancelTo,
  budgetLocked = false,
  // Create only: content shown under the form fields (the document checklist),
  // the project type fixed by a chosen template, and a Site Manager that must be
  // chosen because the starting structure has construction tasks.
  extraSection = null,
  lockProjectType = false,
  siteManagerRequired = false,
  onCancel = null,
  cancelLabel = null,
}) {
  const { t } = useLocale();
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
        if (!cancelled) setListError(extractErrorMessage(err, t("errors.load_form_options")));
      })
      .finally(() => {
        if (!cancelled) setLoadingLists(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per project; a language change must not refetch
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
    if (!form.name.trim()) errors.name = t("form.err_name");
    if (!form.clientName.trim()) errors.clientName = t("form.err_client");
    if (form.budget === "" || Number.isNaN(Number(form.budget)) || Number(form.budget) < 0) errors.budget = t("form.err_budget");
    if (!form.projectType) errors.projectType = t("form.err_type");
    if (!form.municipality.trim()) errors.municipality = t("form.err_municipality");
    if (!form.startDate) errors.startDate = t("form.err_start");
    if (!form.constructionStartDate) errors.constructionStartDate = t("form.err_construction");
    if (!form.endDate) errors.endDate = t("form.err_end");
    if (form.startDate && form.constructionStartDate && form.constructionStartDate < form.startDate) {
      errors.constructionStartDate = t("form.err_construction_before");
    }
    if (form.constructionStartDate && form.endDate && form.endDate < form.constructionStartDate) {
      errors.endDate = t("form.err_end_before");
    }
    if (!form.projectManagerId) errors.projectManagerId = t("form.err_pm");
    if (mode === "create" && siteManagerRequired && !form.siteManagerId) {
      errors.siteManagerId = t("form.err_sm_required");
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
      await onSubmit(payload, form);
    } catch (err) {
      setFormError(extractErrorMessage(err, t("errors.save_project")));
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
          <section className="pf-section">
          <h2 className="pf-section-title">{t("nav.project")}</h2>
          <Field
            label={t("form.project_name")}
            required
            placeholder={t("form.project_name_placeholder")}
            value={form.name}
            error={fieldErrors.name}
            onChange={(e) => updateField("name", e.target.value)}
          />
          <div className="create-project-row">
            <Field
              label={t("form.client_name")}
              required
              placeholder={t("form.client_name_placeholder")}
              value={form.clientName}
              error={fieldErrors.clientName}
              onChange={(e) => updateField("clientName", e.target.value)}
            />
            <Field
              label={t("form.project_type")}
              as="select"
              required
              value={form.projectType}
              error={fieldErrors.projectType}
              disabled={!options || lockProjectType}
              onChange={(e) => updateField("projectType", e.target.value)}
            >
              <option value="">{options ? t("form.select_type") : t("common.loading")}</option>
              {(options?.projectTypes || []).map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </Field>
          </div>
          <Field
            label={t("form.description")}
            as="textarea"
            className="pf-description"
            placeholder={t("form.description_placeholder")}
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
          />

          </section>

          <section className="pf-section">
          <h2 className="pf-section-title">{t("form.section_site")}</h2>
          <div className="create-project-row">
            <Field
              label={t("form.municipality")}
              required
              placeholder={t("form.municipality_placeholder")}
              value={form.municipality}
              error={fieldErrors.municipality}
              onChange={(e) => updateField("municipality", e.target.value)}
            />
            <Field
              label={t("form.province")}
              placeholder={t("form.province_placeholder")}
              value={form.province}
              onChange={(e) => updateField("province", e.target.value)}
            />
          </div>
          <Field
            label={t("form.site_address")}
            placeholder={t("form.address_placeholder")}
            value={form.siteAddress}
            onChange={(e) => updateField("siteAddress", e.target.value)}
          />
          {outsideServiceArea && (
            <Banner tone="warning" title={t("form.outside_title")}>
              {t("form.outside_body", { areas: options.serviceAreaMunicipalities.map(capitalize).join(", ") })}
            </Banner>
          )}
          </section>
        </div>

        <div className="pf-col">
          <section className="pf-section">
          <h2 className="pf-section-title">{t("projects.budget")}</h2>
          <Field
            label={t("form.target_budget")}
            required
            type="text"
            inputMode="decimal"
            prefix="₱"
            placeholder="0.00"
            value={formatAmountInput(form.budget)}
            error={fieldErrors.budget}
            disabled={budgetLocked}
            onChange={(e) => updateField("budget", parseAmountInput(e.target.value))}
          />
          <p className="field-hint">
            {budgetLocked ? t("form.budget_locked") : t("form.budget_auto")}
          </p>

          </section>

          <section className="pf-section">
          <h2 className="pf-section-title">{t("form.section_timeline")}</h2>
          <div className="create-project-row create-project-row-3">
            <Field
              label={t("form.date_dev")}
              required
              type="date"
              value={form.startDate}
              error={fieldErrors.startDate}
              onChange={(e) => updateField("startDate", e.target.value)}
            />
            <Field
              label={t("form.date_construction")}
              required
              type="date"
              value={form.constructionStartDate}
              error={fieldErrors.constructionStartDate}
              onChange={(e) => updateField("constructionStartDate", e.target.value)}
            />
            <Field
              label={t("form.date_end")}
              required
              type="date"
              value={form.endDate}
              error={fieldErrors.endDate}
              onChange={(e) => updateField("endDate", e.target.value)}
            />
          </div>
          <p className="create-project-hint">{t("form.timeline_hint")}</p>

          </section>

          <section className="pf-section">
          <h2 className="pf-section-title">{t("form.section_team")}</h2>
          {listError && <Banner tone="error" title={listError} />}
          {!loadingLists && !listError && availablePMs.length === 0 && (
            <Banner tone="warning" title={t("form.no_pm_title")}>
              {t("form.no_pm_body")}
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
            emptyOptionLabel={t("form.select_pm")}
            onChange={(v) => updateField("projectManagerId", v)}
          />

          {mode === "create" && (
            <ManagerPicker
              label={siteManagerRequired ? t("form.sm_label_required") : t("form.sm_label")}
              required={siteManagerRequired}
              managers={siteManagers}
              loading={loadingLists}
              value={form.siteManagerId}
              error={fieldErrors.siteManagerId}
              emptyOptionLabel={siteManagerRequired ? t("form.sm_select") : t("form.sm_empty")}
              onChange={(v) => updateField("siteManagerId", v)}
            />
          )}
          </section>
        </div>
      </div>

      {extraSection}

      <div className="pf-actions">
        {formError ? <Banner tone="error" title={formError} /> : <span className="pf-actions-note">{t("form.required_note")}</span>}
        <div className="pf-actions-buttons">
          {onCancel ? (
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              {cancelLabel || t("common.cancel")}
            </button>
          ) : (
            <Link to={cancelTo} className="btn btn-secondary">
              {t("common.cancel")}
            </Link>
          )}
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