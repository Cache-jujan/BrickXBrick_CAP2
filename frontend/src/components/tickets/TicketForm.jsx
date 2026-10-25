import { useEffect, useState } from "react";
import { createTicket, listApprovedVendors, listPurchasers } from "../../api/ticketsApi";
import { listProjects } from "../../api/projectsApi";
import { getBomItems } from "../../api/bomApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Field } from "../ui/Field";
import { Button } from "../ui/Button";
import { Banner } from "../ui/Banner";
import { useLocale } from "../../i18n/LocaleProvider";
import "./TicketForm.css";

// Sentinel value for the BOM-item select when the material isn't in the BOM.
// Not a UUID, so it is never sent to the backend as a bomItemID.
const NOT_IN_BOM = "__not_in_bom__";

// Units offered when the creator picks one (Not-in-BOM Material Request or a
// Work Item). On-BOM Material Requests take the unit from the BOM item instead.
const UNIT_OPTIONS = [
  "pcs", "set", "lot", "unit",
  "kg", "g", "L", "mL",
  "m", "cm", "mm", "sq.m", "cu.m",
  "bag", "box", "roll", "sheet", "pair", "bundle", "gal", "can", "truckload",
];

const EMPTY_FORM = {
  projectID: "",
  ticketType: "Material Request",
  subject: "",
  description: "",
  materialType: "",
  quantity: "",
  unit: "",
  vendorName: "",
  requestedBudget: "",
  approvedBudget: "",
  assignedTo: "",
  bomItemID: "",
  notInBomReason: "",
};

// The ticket create form, shared by the standalone CreateTicketPage (Site
// Manager) and the "New ticket" modal on the PM's Ticket Queue. All the role
// logic lives here: a Site Manager raises a request (Pending); a Project
// Manager creates directly (straight to the Purchaser) and sets the approved
// budget. The caller decides what happens on success / cancel.
//
// onSuccess(ticket, { isPM }) — called after the ticket is created.
// onCancel()                  — called when the user backs out.
export function TicketForm({ onSuccess, onCancel, onClose }) {
  const { user } = useAuth();
  const { t, tv } = useLocale();
  const isPM = user?.role === "Project Manager";
  // After a successful create we show a confirmation step (with "Create
  // another") instead of leaving the caller to close immediately.
  const [created, setCreated] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState("");
  const [vendors, setVendors] = useState([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [vendorsError, setVendorsError] = useState("");
  const [purchasers, setPurchasers] = useState([]);
  const [purchasersLoading, setPurchasersLoading] = useState(false);
  const [purchasersError, setPurchasersError] = useState("");
  const [bomItems, setBomItems] = useState([]);
  const [bomItemsLoading, setBomItemsLoading] = useState(false);
  const [bomItemsError, setBomItemsError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listProjects("Active")
      .then((data) => { if (!cancelled) setProjects(data); })
      .catch((err) => { if (!cancelled) setProjectsError(extractErrorMessage(err, t("errors.load_active_projects"))); })
      .finally(() => { if (!cancelled) setProjectsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; a language change must not refetch
  }, []);

  useEffect(() => {
    let cancelled = false;
    listApprovedVendors()
      .then((data) => { if (!cancelled) setVendors(data); })
      .catch((err) => { if (!cancelled) setVendorsError(extractErrorMessage(err, t("errors.load_vendors"))); })
      .finally(() => { if (!cancelled) setVendorsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; a language change must not refetch
  }, []);

  // A PM must assign a Purchaser at creation (the ticket is created already
  // acknowledged), so load the Purchaser list for them.
  useEffect(() => {
    if (!isPM) return undefined;
    let cancelled = false;
    setPurchasersLoading(true);
    listPurchasers()
      .then((data) => { if (!cancelled) setPurchasers(data); })
      .catch((err) => { if (!cancelled) setPurchasersError(extractErrorMessage(err, t("errors.load_purchasers"))); })
      .finally(() => { if (!cancelled) setPurchasersLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; a language change must not refetch
  }, [isPM]);

  // Load the approved BOM items for the Material Request picker whenever the
  // project (or ticket type) changes. Only Material Requests reference the BOM.
  useEffect(() => {
    if (form.ticketType !== "Material Request" || !form.projectID) {
      setBomItems([]);
      setBomItemsError("");
      setBomItemsLoading(false);
      return undefined;
    }
    let cancelled = false;
    setBomItemsLoading(true);
    setBomItemsError("");
    getBomItems(form.projectID)
      .then((data) => { if (!cancelled) setBomItems(Array.isArray(data?.items) ? data.items : []); })
      .catch((err) => { if (!cancelled) setBomItemsError(extractErrorMessage(err, t("errors.load_bom_items"))); })
      .finally(() => { if (!cancelled) setBomItemsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the project or type changes, not on a language change
  }, [form.projectID, form.ticketType]);

  function updateField(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Changing the project or ticket type invalidates the BOM selection.
      if (key === "projectID" || key === "ticketType") {
        next.bomItemID = "";
        next.notInBomReason = "";
      }
      return next;
    });
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
    setFormError("");
  }

  function validate() {
    const errors = {};
    if (!form.projectID) errors.projectID = t("tf.err_project");
    if (!form.ticketType) errors.ticketType = t("tf.err_type");
    if (!form.subject.trim()) errors.subject = t("tf.err_subject");

    const isMaterialReq = form.ticketType === "Material Request";
    const isWorkItem = form.ticketType === "Work Item";
    const notInBom = isMaterialReq && form.bomItemID === NOT_IN_BOM;

    if (isMaterialReq || isWorkItem) {
      if (form.quantity === "" || !Number.isFinite(Number(form.quantity)) || Number(form.quantity) <= 0) {
        errors.quantity = t("tf.err_quantity");
      }
      if (!form.vendorName.trim()) errors.vendorName = t("tf.err_vendor");
      if (isPM && !form.assignedTo) errors.assignedTo = t("tf.err_purchaser");
    }

    // Unit: an on-BOM Material Request takes it from the BOM item, so it's only
    // required when the creator must supply it (Work Item or Not-in-BOM).
    if ((isMaterialReq && notInBom) || isWorkItem) {
      if (!form.unit.trim()) errors.unit = t("tf.err_unit");
    }

    // Work Item keeps a free-text material type.
    if (isWorkItem && !form.materialType.trim()) {
      errors.materialType = t("tf.err_material_type");
    }

    if (isMaterialReq) {
      if (!form.bomItemID) {
        errors.bomItemID = t("tf.err_bom_item");
      }
      if (notInBom) {
        if (!form.materialType.trim()) errors.materialType = t("tf.err_material_type");
        if (!form.notInBomReason.trim()) errors.notInBomReason = t("tf.err_reason");
      }
      // SM states a requested budget; the PM sets the approved budget directly.
      if (isPM) {
        if (form.approvedBudget === "" || !Number.isFinite(Number(form.approvedBudget)) || Number(form.approvedBudget) < 0) {
          errors.approvedBudget = t("tf.err_approved_budget");
        }
      } else if (form.requestedBudget === "" || !Number.isFinite(Number(form.requestedBudget)) || Number(form.requestedBudget) < 0) {
        errors.requestedBudget = t("tf.err_requested_budget");
      }
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

    const isMaterialReq = form.ticketType === "Material Request";
    const isWorkItem = form.ticketType === "Work Item";
    const notInBom = isMaterialReq && form.bomItemID === NOT_IN_BOM;

    const payload = {
      projectID: form.projectID,
      ticketType: form.ticketType,
      subject: form.subject.trim(),
      description: form.description.trim() || undefined,
    };

    if (isMaterialReq || isWorkItem) {
      payload.quantity = Number(form.quantity);
      payload.vendorName = form.vendorName.trim();
      if (isPM) payload.assignedTo = form.assignedTo; // PM assigns the Purchaser now
      // On-BOM Material Requests derive their unit server-side from the BOM
      // item; only send a unit when the creator picked one.
      if ((isMaterialReq && notInBom) || isWorkItem) payload.unit = form.unit;
    }
    if (isWorkItem) {
      payload.materialType = form.materialType.trim();
    }
    if (isMaterialReq) {
      if (isPM) {
        payload.approvedBudget = Number(form.approvedBudget);
      } else {
        payload.requestedBudget = Number(form.requestedBudget);
      }
      if (notInBom) {
        payload.notInBom = true;
        payload.notInBomReason = form.notInBomReason.trim();
        payload.materialType = form.materialType.trim();
      } else {
        // materialType is derived from the BOM item on the server.
        payload.bomItemID = form.bomItemID;
      }
    }

    setSubmitting(true);
    try {
      const ticket = await createTicket(payload);
      setCreated(ticket);
      onSuccess?.(ticket, { isPM });
    } catch (err) {
      setFormError(extractErrorMessage(err, t("errors.create_ticket")));
    } finally {
      setSubmitting(false);
    }
  }

  function handleCreateAnother() {
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError("");
    setCreated(null);
  }

  const isMaterialReq = form.ticketType === "Material Request";
  const isWorkItem = form.ticketType === "Work Item";
  const notInBom = isMaterialReq && form.bomItemID === NOT_IN_BOM;
  // An on-BOM item carries its own unit — show it read-only so it's clear the
  // request will use the BOM's unit, not a free choice.
  const selectedBomItem = bomItems.find((it) => it.bomItemId === form.bomItemID);
  const onBomUnit = isMaterialReq && form.bomItemID && !notInBom ? selectedBomItem?.unit : null;
  const needsUnitPicker = (isMaterialReq && notInBom) || isWorkItem;

  // Group the BOM items by their section for the picker.
  const groupedBomItems = Object.entries(
    bomItems.reduce((acc, it) => {
      const key = it.section || "Other";
      (acc[key] = acc[key] || []).push(it);
      return acc;
    }, {})
  );

  if (created) {
    return (
      <div className="ticket-form-success">
        <span className="ticket-form-success-check" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <h3 className="ticket-form-success-title">{t("tf.created_title")}</h3>
        <p className="ticket-form-success-text">
          {t(isPM ? "tf.created_pm" : "tf.created_sm", { subject: created.subject })}
        </p>
        <div className="ticket-form-success-actions">
          <Button type="button" variant="secondary" onClick={handleCreateAnother}>
            {t("tf.create_another")}
          </Button>
          <Button type="button" onClick={() => (onClose || onCancel)?.()}>
            {t("common.done")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="ticket-form" onSubmit={handleSubmit} noValidate>
      {projectsError && <Banner tone="error" title={projectsError} />}
      {vendorsError && <Banner tone="error" title={vendorsError} />}
      {isPM && purchasersError && <Banner tone="error" title={purchasersError} />}

      <Field
        label={t("nav.project")}
        as="select"
        required
        value={form.projectID}
        error={fieldErrors.projectID}
        disabled={projectsLoading || projects.length === 0}
        onChange={(e) => updateField("projectID", e.target.value)}
      >
        <option value="">{projectsLoading ? t("common.loading") : t("tf.select_project")}</option>
        {projects.map((project) => (
          <option key={project.projectid} value={project.projectid}>
            {project.name}
          </option>
        ))}
      </Field>

      <Field
        label={t("tf.ticket_type")}
        as="select"
        required
        value={form.ticketType}
        error={fieldErrors.ticketType}
        onChange={(e) => updateField("ticketType", e.target.value)}
      >
        <option value="Material Request">{tv("tickettype", "Material Request")}</option>
        <option value="Work Item">{tv("tickettype", "Work Item")}</option>
        {!isPM && <option value="Report">{tv("tickettype", "Report")}</option>}
      </Field>

      <Field
        label={t("tf.subject")}
        required
        placeholder={t("tf.subject_ph")}
        value={form.subject}
        error={fieldErrors.subject}
        onChange={(e) => updateField("subject", e.target.value)}
      />

      <Field
        label={t("tf.description")}
        as="textarea"
        placeholder={t("tf.description_ph")}
        value={form.description}
        onChange={(e) => updateField("description", e.target.value)}
      />

      {(isMaterialReq || isWorkItem) && (
        <div className="create-ticket-procurement">
          <p className="create-ticket-section-label">{t("tf.procurement")}</p>

          {isMaterialReq && (
            <>
              <Field
                label={t("tf.bom_item")}
                as="select"
                required
                value={form.bomItemID}
                error={fieldErrors.bomItemID}
                disabled={!form.projectID || bomItemsLoading}
                onChange={(e) => updateField("bomItemID", e.target.value)}
              >
                <option value="">
                  {!form.projectID
                    ? t("tf.select_project_first")
                    : bomItemsLoading
                    ? t("tf.loading_bom")
                    : t("tf.select_bom")}
                </option>
                {groupedBomItems.map(([section, items]) => (
                  <optgroup key={section} label={section}>
                    {items.map((it) => (
                      <option key={it.bomItemId} value={it.bomItemId}>
                        {it.description} ({it.unit})
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value={NOT_IN_BOM}>{t("tf.not_in_bom")}</option>
              </Field>

              {bomItemsError && <Banner tone="error" title={bomItemsError} />}
              {!bomItemsLoading && form.projectID && bomItems.length === 0 && !bomItemsError && (
                <p role="status">
                  {t("tf.no_bom_items")}
                </p>
              )}

              {notInBom && (
                <>
                  <Field
                    label={t("tf.material_type")}
                    required
                    placeholder={t("tf.material_type_ph_light")}
                    value={form.materialType}
                    error={fieldErrors.materialType}
                    onChange={(e) => updateField("materialType", e.target.value)}
                  />
                  <Field
                    label={t("tf.not_in_bom_reason")}
                    as="textarea"
                    required
                    placeholder={t("tf.not_in_bom_reason_ph")}
                    value={form.notInBomReason}
                    error={fieldErrors.notInBomReason}
                    onChange={(e) => updateField("notInBomReason", e.target.value)}
                  />
                </>
              )}
            </>
          )}

          {isWorkItem && (
            <Field
              label={t("tf.material_type")}
              required
              placeholder={t("tf.material_type_ph_cement")}
              value={form.materialType}
              error={fieldErrors.materialType}
              onChange={(e) => updateField("materialType", e.target.value)}
            />
          )}

          <div className="ticket-form-qty-row">
            <Field
              label={t("bom.aria_quantity")}
              required
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0"
              value={form.quantity}
              error={fieldErrors.quantity}
              onChange={(e) => updateField("quantity", e.target.value)}
            />
            {needsUnitPicker ? (
              <Field
                label={t("bom.col_unit")}
                as="select"
                required
                value={form.unit}
                error={fieldErrors.unit}
                onChange={(e) => updateField("unit", e.target.value)}
              >
                <option value="">{t("tf.select_unit")}</option>
                {UNIT_OPTIONS.map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </Field>
            ) : (
              <Field
                label={t("bom.col_unit")}
                value={onBomUnit || ""}
                placeholder={t("tf.unit_from_bom")}
                readOnly
                disabled
              />
            )}
          </div>

          <Field
            label={t("tf.preferred_vendor")}
            as="select"
            required
            value={form.vendorName}
            error={fieldErrors.vendorName}
            disabled={vendorsLoading || vendors.length === 0}
            onChange={(e) => updateField("vendorName", e.target.value)}
          >
            <option value="">
              {vendorsLoading ? t("tf.loading_vendors") : vendors.length ? t("tf.select_vendor") : t("tf.no_vendors")}
            </option>
            {vendors.map((vendor) => (
              <option key={vendor.vendorID} value={vendor.vendorName}>{vendor.vendorName}</option>
            ))}
          </Field>
          {!vendorsLoading && vendors.length === 0 && !vendorsError && (
            <p role="status">{t("tf.no_vendors_help")}</p>
          )}

          {isPM && (
            <Field
              label={t("tf.assign_purchaser")}
              as="select"
              required
              value={form.assignedTo}
              error={fieldErrors.assignedTo}
              disabled={purchasersLoading || purchasers.length === 0}
              onChange={(e) => updateField("assignedTo", e.target.value)}
            >
              <option value="">
                {purchasersLoading ? t("tf.loading_purchasers") : purchasers.length ? t("tf.select_purchaser") : t("tf.no_purchasers")}
              </option>
              {purchasers.map((p) => (
                <option key={p.userid} value={p.userid}>{p.name} ({p.email})</option>
              ))}
            </Field>
          )}

          {isMaterialReq && !isPM && (
            <Field
              label={t("tf.requested_budget")}
              required
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.requestedBudget}
              error={fieldErrors.requestedBudget}
              onChange={(e) => updateField("requestedBudget", e.target.value)}
            />
          )}
          {isMaterialReq && isPM && (
            <Field
              label={t("tf.approved_budget")}
              required
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.approvedBudget}
              error={fieldErrors.approvedBudget}
              onChange={(e) => updateField("approvedBudget", e.target.value)}
            />
          )}
        </div>
      )}

      {formError && <Banner tone="error" title={formError} />}

      <div className="create-ticket-actions">
        <Button type="button" variant="secondary" onClick={() => onCancel?.()} disabled={submitting}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={submitting || projectsLoading || projects.length === 0}>
          {submitting ? t("common.submitting") : isPM ? t("tf.create_assign") : t("tf.submit_ticket")}
        </Button>
      </div>
    </form>
  );
}