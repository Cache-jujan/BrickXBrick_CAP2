import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createTicket, listApprovedVendors, listPurchasers } from "../../api/ticketsApi";
import { listProjects } from "../../api/projectsApi";
import { getBomItems } from "../../api/bomApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { Banner } from "../../components/ui/Banner";
import { Card } from "../../components/ui/Card";
import "./CreateTicketPage.css";
import { BackLink } from "../../components/ui/BackLink";

// Sentinel value for the BOM-item select when the material isn't in the BOM.
// Not a UUID, so it is never sent to the backend as a bomItemID.
const NOT_IN_BOM = "__not_in_bom__";

const EMPTY_FORM = {
  projectID: "",
  ticketType: "Material Request",
  subject: "",
  description: "",
  materialType: "",
  quantity: "",
  vendorName: "",
  requestedBudget: "",
  approvedBudget: "",
  assignedTo: "",
  bomItemID: "",
  notInBomReason: "",
};

export function CreateTicketPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // A Site Manager raises a request (Pending); a Project Manager creates
  // directly (goes straight to the Purchaser) and sets the approved budget.
  const isPM = user?.role === "Project Manager";
  const dashPath = isPM ? "/dashboard/pm" : "/dashboard/sm";

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

  useEffect(() => {
    let cancelled = false;
    listApprovedVendors()
      .then((data) => {
        if (!cancelled) setVendors(data);
      })
      .catch((err) => {
        if (!cancelled) setVendorsError(extractErrorMessage(err, "Couldn't load approved vendors."));
      })
      .finally(() => {
        if (!cancelled) setVendorsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // A PM must assign a Purchaser at creation (the ticket is created already
  // acknowledged), so load the Purchaser list for them.
  useEffect(() => {
    if (!isPM) return;
    let cancelled = false;
    setPurchasersLoading(true);
    listPurchasers()
      .then((data) => {
        if (!cancelled) setPurchasers(data);
      })
      .catch((err) => {
        if (!cancelled) setPurchasersError(extractErrorMessage(err, "Couldn't load Purchasers."));
      })
      .finally(() => {
        if (!cancelled) setPurchasersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isPM]);

  // Load the approved BOM items for the Material Request picker whenever the
  // project (or ticket type) changes. Only Material Requests reference the BOM.
  useEffect(() => {
    if (form.ticketType !== "Material Request" || !form.projectID) {
      setBomItems([]);
      setBomItemsError("");
      setBomItemsLoading(false);
      return;
    }
    let cancelled = false;
    setBomItemsLoading(true);
    setBomItemsError("");
    getBomItems(form.projectID)
      .then((data) => {
        if (!cancelled) setBomItems(Array.isArray(data?.items) ? data.items : []);
      })
      .catch((err) => {
        if (!cancelled) setBomItemsError(extractErrorMessage(err, "Couldn't load this project's BOM items."));
      })
      .finally(() => {
        if (!cancelled) setBomItemsLoading(false);
      });

    return () => {
      cancelled = true;
    };
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
    if (!form.projectID) errors.projectID = "Select a project.";
    if (!form.ticketType) errors.ticketType = "Select a ticket type.";
    if (!form.subject.trim()) errors.subject = "Subject is required.";

    const isMaterialReq = form.ticketType === "Material Request";
    const isWorkItem = form.ticketType === "Work Item";
    const notInBom = isMaterialReq && form.bomItemID === NOT_IN_BOM;

    if (isMaterialReq || isWorkItem) {
      if (form.quantity === "" || !Number.isFinite(Number(form.quantity)) || Number(form.quantity) <= 0) {
        errors.quantity = "Enter a quantity greater than 0.";
      }
      if (!form.vendorName.trim()) errors.vendorName = "Vendor name is required.";
      if (isPM && !form.assignedTo) errors.assignedTo = "Choose a Purchaser to assign.";
    }

    // Work Item keeps a free-text material type.
    if (isWorkItem && !form.materialType.trim()) {
      errors.materialType = "Material type is required.";
    }

    if (isMaterialReq) {
      if (!form.bomItemID) {
        errors.bomItemID = "Pick a BOM item, or choose “Not in the BOM”.";
      }
      if (notInBom) {
        if (!form.materialType.trim()) errors.materialType = "Material type is required.";
        if (!form.notInBomReason.trim()) errors.notInBomReason = "Give a reason the item isn’t in the BOM.";
      }
      // SM states a requested budget; the PM sets the approved budget directly.
      if (isPM) {
        if (form.approvedBudget === "" || !Number.isFinite(Number(form.approvedBudget)) || Number(form.approvedBudget) < 0) {
          errors.approvedBudget = "Enter an approved budget of 0 or more.";
        }
      } else if (form.requestedBudget === "" || !Number.isFinite(Number(form.requestedBudget)) || Number(form.requestedBudget) < 0) {
        errors.requestedBudget = "Enter a requested budget of 0 or more.";
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
      navigate(dashPath, {
        replace: true,
        state: { successMessage: `Ticket “${ticket.subject}” was ${isPM ? "created and sent to the Purchaser" : "submitted"}.` },
      });
    } catch (err) {
      setFormError(extractErrorMessage(err, "Couldn't create the ticket. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  const isMaterialReq = form.ticketType === "Material Request";
  const isWorkItem = form.ticketType === "Work Item";
  const notInBom = isMaterialReq && form.bomItemID === NOT_IN_BOM;

  // Group the BOM items by their section for the picker.
  const groupedBomItems = Object.entries(
    bomItems.reduce((acc, it) => {
      const key = it.section || "Other";
      (acc[key] = acc[key] || []).push(it);
      return acc;
    }, {})
  );

  return (
    <div className="create-ticket">
      <BackLink to={dashPath}>Back to Dashboard</BackLink>
      <h1 className="create-ticket-title">Create Ticket</h1>

      <Card className="create-ticket-card">
        <form onSubmit={handleSubmit} noValidate>
          {projectsError && <Banner tone="error" title={projectsError} />}
          {vendorsError && <Banner tone="error" title={vendorsError} />}
          {isPM && purchasersError && <Banner tone="error" title={purchasersError} />}

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
            {!isPM && <option value="Report">Report</option>}
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

          {(isMaterialReq || isWorkItem) && (
            <div className="create-ticket-procurement">
              <p className="create-ticket-section-label">Procurement details</p>

              {isMaterialReq && (
                <>
                  <Field
                    label="BOM Item"
                    as="select"
                    required
                    value={form.bomItemID}
                    error={fieldErrors.bomItemID}
                    disabled={!form.projectID || bomItemsLoading}
                    onChange={(e) => updateField("bomItemID", e.target.value)}
                  >
                    <option value="">
                      {!form.projectID
                        ? "Select a project first"
                        : bomItemsLoading
                        ? "Loading BOM items…"
                        : "Select a BOM item"}
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
                    <option value={NOT_IN_BOM}>— Not in the BOM —</option>
                  </Field>

                  {bomItemsError && <Banner tone="error" title={bomItemsError} />}
                  {!bomItemsLoading && form.projectID && bomItems.length === 0 && !bomItemsError && (
                    <p role="status">
                      This project’s BOM has no items to pick from. Choose “Not in the BOM” and give a reason.
                    </p>
                  )}

                  {notInBom && (
                    <>
                      <Field
                        label="Material Type"
                        required
                        placeholder="e.g. Pendant light"
                        value={form.materialType}
                        error={fieldErrors.materialType}
                        onChange={(e) => updateField("materialType", e.target.value)}
                      />
                      <Field
                        label="Reason it isn’t in the BOM"
                        as="textarea"
                        required
                        placeholder="e.g. Additional fixture, billed separately"
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
                  label="Material Type"
                  required
                  placeholder="e.g. Cement"
                  value={form.materialType}
                  error={fieldErrors.materialType}
                  onChange={(e) => updateField("materialType", e.target.value)}
                />
              )}

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

              <Field
                label="Preferred Vendor"
                as="select"
                required
                value={form.vendorName}
                error={fieldErrors.vendorName}
                disabled={vendorsLoading || vendors.length === 0}
                onChange={(e) => updateField("vendorName", e.target.value)}
              >
                <option value="">
                  {vendorsLoading ? "Loading approved vendors…" : vendors.length ? "Select an approved vendor" : "No approved vendors available"}
                </option>
                {vendors.map((vendor) => (
                  <option key={vendor.vendorID} value={vendor.vendorName}>{vendor.vendorName}</option>
                ))}
              </Field>
              {!vendorsLoading && vendors.length === 0 && !vendorsError && (
                <p role="status">No approved vendors are available. Ask a System Administrator to add one to the Vendor Master List.</p>
              )}

              {isPM && (
                <Field
                  label="Assign to Purchaser"
                  as="select"
                  required
                  value={form.assignedTo}
                  error={fieldErrors.assignedTo}
                  disabled={purchasersLoading || purchasers.length === 0}
                  onChange={(e) => updateField("assignedTo", e.target.value)}
                >
                  <option value="">
                    {purchasersLoading ? "Loading Purchasers…" : purchasers.length ? "Select a Purchaser" : "No active Purchasers available"}
                  </option>
                  {purchasers.map((p) => (
                    <option key={p.userid} value={p.userid}>{p.name} ({p.email})</option>
                  ))}
                </Field>
              )}

              {isMaterialReq && !isPM && (
                <Field
                  label="Requested Budget (PHP)"
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
                  label="Approved Budget (PHP)"
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
            <Link to={dashPath} className="btn btn-secondary">Cancel</Link>
            <Button type="submit" disabled={submitting || projectsLoading || projects.length === 0}>
              {submitting ? "Submitting…" : isPM ? "Create & Assign" : "Submit Ticket"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}