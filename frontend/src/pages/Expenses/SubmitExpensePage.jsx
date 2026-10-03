import { useEffect, useMemo, useState } from "react";
import {Link, useNavigate, useSearchParams,} from "react-router-dom";
import { listProjects } from "../../api/projectsApi";
import { getExpense, resubmitExpense, scanReceipt, submitExpense } from "../../api/expensesApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import "./SubmitExpensePage.css";

const CATEGORIES = ["Materials", "Equipment", "Other"];

function makeLineItem(item = {}) {
  const id = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return {
    id,
    description: item.description || "",
    amount: item.amount == null ? "" : String(item.amount),
    quantity: item.quantity == null ? "1" : String(item.quantity),
  };
}

function initialForm() {
  return {
    projectID: "",
    vendorName: "",
    amount: "",
    receiptDate: "",
    category: "Materials",
    receiptImageURL: "",
    birNumber: "",
    tin: "",
    birPermitNumber: "",
    lineItems: [makeLineItem()],
  };
}

export function SubmitExpensePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resubmitId = searchParams.get("resubmit");
  const [rejectionReason, setRejectionReason] = useState("");
  const { user } = useAuth();
  const [form, setForm] = useState(initialForm);
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
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
    if (!resubmitId) return;

    getExpense(resubmitId)
      .then((expense) => {
        setForm((previous) => ({
          ...previous,
          projectID: expense.projectID || "",
          vendorName: expense.vendorName || "",
          amount: expense.amount ?? "",
          receiptDate: expense.receiptDate
            ? String(expense.receiptDate).slice(0, 10)
            : "",
          category: expense.category || "",
          tin: expense.tin || "",
          birPermitNumber: expense.birPermitNumber || "",
          birNumber: expense.birNumber || "",
          receiptImageURL: expense.receiptImageURL || "",
          lineItems: expense.lineItems || [makeLineItem()],
        }));

        setRejectionReason(expense.rejectionReason || "");
      })
      .catch((err) => {
        setFormError(
          extractErrorMessage(err, "Could not load the rejected expense.")
        );
      });
  }, [resubmitId]);

  const visibleProjects = useMemo(() => {
    if (user?.role !== "Project Manager") return projects;
    return projects.filter((project) => project.projectmanagerid === user.id);
  }, [projects, user]);

  function updateField(key, value) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setFieldErrors((previous) => ({ ...previous, [key]: undefined }));
  }

  function updateLineItem(id, key, value) {
    setForm((previous) => ({
      ...previous,
      lineItems: previous.lineItems.map((item) =>
        item.id === id ? { ...item, [key]: value } : item
      ),
    }));
    setFieldErrors((previous) => ({ ...previous, lineItems: undefined }));
  }

  function addLineItem() {
    setForm((previous) => ({
      ...previous,
      lineItems: [...previous.lineItems, makeLineItem()],
    }));
  }

  function removeLineItem(id) {
    setForm((previous) => ({
      ...previous,
      lineItems: previous.lineItems.filter((item) => item.id !== id),
    }));
  }

  async function handleScan() {
    if (!selectedFile) return;
    setScanning(true);
    setScanMessage("");
    setFormError("");
    try {
      const result = await scanReceipt(selectedFile);
      setForm((previous) => ({
        ...previous,
        vendorName: result.vendorName || previous.vendorName,
        amount: result.amount == null ? previous.amount : String(result.amount),
        receiptDate: result.receiptDate || previous.receiptDate,
        receiptImageURL: result.receiptImageURL || previous.receiptImageURL,
        birNumber: result.birNumber || previous.birNumber,
        tin: result.tin || previous.tin,
        birPermitNumber: result.birPermitNumber || previous.birPermitNumber,
        lineItems: result.lineItems?.length
          ? result.lineItems.map(makeLineItem)
          : previous.lineItems,
      }));
      setScanMessage(
        result.ocrError
          ? result.ocrError
          : "Receipt uploaded. Review the extracted details before submitting."
      );
    } catch (err) {
      setFormError(extractErrorMessage(err, "Couldn't scan this receipt."));
    } finally {
      setScanning(false);
    }
  }

  function validate() {
    const errors = {};
    if (!form.projectID) errors.projectID = "Select an active project.";
    if (!form.vendorName.trim()) errors.vendorName = "Vendor name is required.";
    if (form.amount === "" || !Number.isFinite(Number(form.amount)) || Number(form.amount) < 0) {
      errors.amount = "Enter a valid amount of 0 or more.";
    }
    if (!form.receiptDate) errors.receiptDate = "Receipt date is required.";
    if (!form.receiptImageURL) errors.receiptImageURL = "Upload and scan a receipt first.";
    const usableItems = form.lineItems.filter((item) => item.description.trim());
    if (usableItems.length === 0) {
      errors.lineItems = "Add at least one line item.";
    } else if (usableItems.some((item) => item.amount === "" || !Number.isFinite(Number(item.amount)) || Number(item.amount) < 0)) {
      errors.lineItems = "Every line item needs a valid amount of 0 or more.";
    }
    return errors;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
      try {
        const payload = {
          projectID: form.projectID,
          vendorName: form.vendorName.trim(),
          amount: Number(form.amount),
          receiptDate: form.receiptDate,
          category: form.category,
          receiptImageURL: form.receiptImageURL,
          birNumber: form.birNumber.trim() || undefined,
          tin: form.tin.trim() || undefined,
          birPermitNumber: form.birPermitNumber.trim() || undefined,
          lineItems: form.lineItems
            .filter((item) => item.description.trim())
            .map((item) => ({
              description: item.description.trim(),
              amount: Number(item.amount),
              quantity: item.quantity === "" ? 1 : Number(item.quantity),
            })),
        };

        if (resubmitId) {
          await resubmitExpense(resubmitId, payload);
        } else {
          await submitExpense(payload);
        }

        navigate("/expenses", { replace: true });
      } catch (err) {
        setFormError(extractErrorMessage(err, "Couldn't submit the expense. Please try again."));
      } finally {
        setSubmitting(false);
      }
  }

  return (
    <div className="submit-expense">
      <Link to="/expenses" className="form-back-link">Back to Expenses</Link>
      <div className="submit-expense-heading">
        <div>
          <h1 className="submit-expense-title">{resubmitId ? "Correct Expense" : "Submit Expense"}</h1>
          <p className="submit-expense-subtitle">
            {resubmitId
              ? "Correct the rejected receipt, then send it back to the PM review queue."
              : "Upload a receipt, review the extracted details, and send the expense for review."}
          </p>
        </div>
      </div>

      {resubmitId && rejectionReason && (
        <Banner tone="error" title="PM rejection reason">
          {rejectionReason}
        </Banner>
      )}

      <Card className="submit-expense-card">
        <form onSubmit={handleSubmit} noValidate>
          <section className="submit-expense-section">
            <h2>Receipt</h2>
            <p className="submit-expense-help">JPEG, PNG, or PDF up to 10 MB. Scanning stores the receipt and fills any fields the OCR service can read.</p>
            <div className="receipt-upload-row">
              <input
                className="receipt-file-input"
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                onChange={(event) => {
                  setSelectedFile(event.target.files?.[0] || null);
                  setScanMessage("");
                  setFieldErrors((previous) => ({ ...previous, receiptImageURL: undefined }));
                }}
              />
              <Button type="button" variant="secondary" disabled={!selectedFile || scanning} onClick={handleScan}>
                {scanning ? "Scanning…" : "Scan Receipt"}
              </Button>
            </div>
            {selectedFile && <p className="receipt-file-name">Selected: {selectedFile.name}</p>}
            {scanMessage && <Banner tone="warning" title={scanMessage} />}
            {fieldErrors.receiptImageURL && <p className="field-error">{fieldErrors.receiptImageURL}</p>}
          </section>

          <section className="submit-expense-section">
            <h2>Expense details</h2>
            <Field
              label="Project"
              as="select"
              required
              value={form.projectID}
              error={fieldErrors.projectID}
              disabled={projectsLoading || visibleProjects.length === 0}
              onChange={(event) => updateField("projectID", event.target.value)}
            >
              <option value="">{projectsLoading ? "Loading active projects…" : "Select an active project"}</option>
              {visibleProjects.map((project) => (
                <option key={project.projectid} value={project.projectid}>
                  {project.name}{project.clientname ? ` — ${project.clientname}` : ""}
                </option>
              ))}
            </Field>
            {projectsError && <Banner tone="error" title={projectsError} />}
            {!projectsLoading && !projectsError && visibleProjects.length === 0 && (
              <Banner tone="warning" title="No active projects available">
                You need an active project you can manage before submitting an expense.
              </Banner>
            )}

            <div className="submit-expense-row">
              <Field label="Vendor name" required placeholder="Enter vendor name" value={form.vendorName} error={fieldErrors.vendorName} onChange={(event) => updateField("vendorName", event.target.value)} />
              <Field label="Amount (PHP)" required type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} error={fieldErrors.amount} onChange={(event) => updateField("amount", event.target.value)} />
            </div>
            <div className="submit-expense-row">
              <Field label="Receipt date" required type="date" value={form.receiptDate} error={fieldErrors.receiptDate} onChange={(event) => updateField("receiptDate", event.target.value)} />
              <Field label="Category" as="select" required value={form.category} onChange={(event) => updateField("category", event.target.value)}>
                {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </Field>
            </div>
          </section>

          <section className="submit-expense-section">
            <div className="submit-expense-section-heading">
              <div>
                <h2>Line items</h2>
                <p className="submit-expense-help">Add at least one item. Quantity is used for ticket and fraud checks.</p>
              </div>
              <Button type="button" variant="ghost" onClick={addLineItem}>+ Add item</Button>
            </div>
            <div className="line-items-header"><span>Description</span><span>Amount (PHP)</span><span>Quantity</span><span /></div>
            {form.lineItems.map((item) => (
              <div className="line-item-row" key={item.id}>
                <input aria-label="Line item description" className="field-control" placeholder="Item description" value={item.description} onChange={(event) => updateLineItem(item.id, "description", event.target.value)} />
                <input aria-label="Line item amount" className="field-control" type="number" min="0" step="0.01" placeholder="0.00" value={item.amount} onChange={(event) => updateLineItem(item.id, "amount", event.target.value)} />
                <input aria-label="Line item quantity" className="field-control" type="number" min="0" step="1" placeholder="1" value={item.quantity} onChange={(event) => updateLineItem(item.id, "quantity", event.target.value)} />
                <button type="button" className="line-item-remove" aria-label="Remove line item" disabled={form.lineItems.length === 1} onClick={() => removeLineItem(item.id)}>Remove</button>
              </div>
            ))}
            {fieldErrors.lineItems && <p className="field-error">{fieldErrors.lineItems}</p>}
          </section>

          <section className="submit-expense-section">
            <h2>Tax receipt details <span className="optional-label">optional</span></h2>
            <div className="submit-expense-row">
              <Field label="TIN" placeholder="Vendor TIN" value={form.tin} onChange={(event) => updateField("tin", event.target.value)} />
              <Field label="BIR permit number" placeholder="BIR permit number" value={form.birPermitNumber} onChange={(event) => updateField("birPermitNumber", event.target.value)} />
            </div>
            <Field label="OR/SI number" placeholder="Official receipt or sales invoice number" value={form.birNumber} onChange={(event) => updateField("birNumber", event.target.value)} />
          </section>

          {formError && <Banner tone="error" title={formError} />}
          <div className="submit-expense-actions">
            <Link to="/expenses" className="btn btn-secondary">Cancel</Link>
            <Button type="submit" disabled={submitting || projectsLoading || visibleProjects.length === 0}>
              {submitting ? "Submitting…" : "Submit Expense"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
