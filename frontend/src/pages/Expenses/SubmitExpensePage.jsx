import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listProjects } from "../../api/projectsApi";
import { listExpenseTickets } from "../../api/ticketsApi";
import { scanReceipt, submitExpense } from "../../api/expensesApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import "./SubmitExpensePage.css";

const CATEGORIES = ["Materials", "Equipment", "Other"];
const EMPTY_FORM = {
  vendorName: "",
  tin: "",
  birPermitNumber: "",
  birNumber: "",
  amount: "",
  receiptDate: "",
  category: "Materials",
};

function makeItem(description = "", amount = "", quantity = "1") {
  return { id: Math.random().toString(36).slice(2), description, amount: amount === null ? "" : String(amount), quantity: String(quantity || 1) };
}

export function SubmitExpensePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [file, setFile] = useState(null);
  const [receiptImageURL, setReceiptImageURL] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [items, setItems] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [ticketId, setTicketId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [loadingChoices, setLoadingChoices] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([listProjects("Active"), listExpenseTickets()])
      .then(([projectList, ticketList]) => {
        if (cancelled) return;
        setProjects(projectList);
        setTickets(ticketList);
      })
      .catch((err) => { if (!cancelled) setError(extractErrorMessage(err, "Couldn't load projects and resolved tickets.")); })
      .finally(() => { if (!cancelled) setLoadingChoices(false); });
    return () => { cancelled = true; };
  }, []);

  const selectedTicket = useMemo(() => tickets.find((ticket) => ticket.ticketid === ticketId), [tickets, ticketId]);
  const availableProjects = useMemo(() => {
    if (user.role !== "Project Manager") return projects;
    return projects.filter((project) => project.projectmanagerid === user.id);
  }, [projects, user.id, user.role]);

  function updateField(name, value) { setForm((current) => ({ ...current, [name]: value })); }
  function updateItem(id, patch) { setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)); }

  async function handleScan(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setError("");
    setNotice("");
    setScanning(true);
    try {
      const draft = await scanReceipt(selected);
      setReceiptImageURL(draft.receiptImageURL || "");
      setForm({
        vendorName: draft.vendorName || "",
        tin: draft.tin || "",
        birPermitNumber: draft.birPermitNumber || "",
        birNumber: draft.birNumber || "",
        amount: draft.amount ?? "",
        receiptDate: draft.receiptDate || "",
        category: "Materials",
      });
      const draftItems = Array.isArray(draft.lineItems) && draft.lineItems.length
        ? draft.lineItems.map((item) => makeItem(item.description, item.amount, item.quantity))
        : [makeItem(draft.vendorName || "", draft.amount ?? "", 1)];
      setItems(draftItems);
      setNotice(draft.ocrError || "Receipt uploaded. Review every extracted field before submitting.");
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't scan the receipt. You can retry with another image or PDF."));
    } finally { setScanning(false); }
  }

  function handleTicketChange(value) {
    setTicketId(value);
    const ticket = tickets.find((item) => item.ticketid === value);
    if (ticket) setProjectId(ticket.projectid);
  }

  function validate() {
    if (!receiptImageURL) return "Upload and scan a receipt first.";
    if (!form.vendorName.trim() || !form.receiptDate || form.amount === "") return "Vendor, total amount, and receipt date are required.";
    if (!Number.isFinite(Number(form.amount)) || Number(form.amount) < 0) return "Enter a valid non-negative amount.";
    if (items.length === 0 || items.some((item) => !item.description.trim() || !Number.isFinite(Number(item.amount)) || Number(item.amount) < 0)) return "Add at least one valid line item.";
    if (!ticketId && !projectId) return "Select a resolved procurement ticket or a project.";
    return "";
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setSubmitting(true);
    try {
      await submitExpense({
        ticketID: ticketId || undefined,
        projectID: ticketId ? undefined : projectId,
        vendorName: form.vendorName.trim(),
        amount: Number(form.amount),
        receiptDate: form.receiptDate,
        category: form.category,
        receiptImageURL,
        tin: form.tin.trim() || undefined,
        birPermitNumber: form.birPermitNumber.trim() || undefined,
        birNumber: form.birNumber.trim() || undefined,
        lineItems: items.map((item) => ({ description: item.description.trim(), amount: Number(item.amount), quantity: Number(item.quantity) || 1 })),
      });
      navigate("/expenses", { replace: true, state: { successMessage: "Expense submitted for review." } });
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't submit the expense. Please review the fields and try again."));
    } finally { setSubmitting(false); }
  }

  return (
    <div className="submit-expense-page">
      <Link to="/expenses" className="form-back-link">Back to Expenses</Link>
      <div className="submit-expense-header">
        <div><h1>Submit Expense</h1><p>Upload a receipt, verify the extracted fields, and link it to a project.</p></div>
        <span className="submit-expense-role">{user.role}</span>
      </div>
      {error && <Banner tone="error" title={error} />}
      {notice && <Banner tone="warning" title="Review before submitting">{notice}</Banner>}
      <Card className="submit-expense-card">
        <form onSubmit={handleSubmit} noValidate>
          <section className="submit-expense-section">
            <h2>1. Capture receipt</h2>
            <label className="upload-box">
              <span>{scanning ? "Scanning receipt…" : file ? file.name : "Choose a camera image, gallery image, or PDF"}</span>
              <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={handleScan} disabled={scanning} />
            </label>
            <p className="submit-expense-help">Maximum 10 MB. OCR may leave fields blank; correct them below.</p>
          </section>

          <section className="submit-expense-section">
            <h2>2. Review and correct</h2>
            <div className="submit-expense-grid">
              <Field label="Vendor" required value={form.vendorName} onChange={(e) => updateField("vendorName", e.target.value)} />
              <Field label="Total amount (PHP)" required type="number" min="0" step="0.01" value={form.amount} onChange={(e) => updateField("amount", e.target.value)} />
              <Field label="Receipt date" required type="date" value={form.receiptDate} onChange={(e) => updateField("receiptDate", e.target.value)} />
              <Field label="Category" required as="select" value={form.category} onChange={(e) => updateField("category", e.target.value)}>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</Field>
              <Field label="TIN" value={form.tin} onChange={(e) => updateField("tin", e.target.value)} />
              <Field label="BIR permit number" value={form.birPermitNumber} onChange={(e) => updateField("birPermitNumber", e.target.value)} />
              <Field label="OR/SI number" value={form.birNumber} onChange={(e) => updateField("birNumber", e.target.value)} />
            </div>
            <div className="line-items-header"><h3>Line items</h3><button type="button" className="text-button" onClick={() => setItems((current) => [...current, makeItem()])}>+ Add item</button></div>
            {items.map((item) => <div className="line-item" key={item.id}>
              <input aria-label="Item description" placeholder="Description" value={item.description} onChange={(e) => updateItem(item.id, { description: e.target.value })} />
              <input aria-label="Item quantity" type="number" min="1" step="1" placeholder="Qty" value={item.quantity} onChange={(e) => updateItem(item.id, { quantity: e.target.value })} />
              <input aria-label="Item amount" type="number" min="0" step="0.01" placeholder="Amount" value={item.amount} onChange={(e) => updateItem(item.id, { amount: e.target.value })} />
              <button type="button" className="remove-item" onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))} aria-label="Remove line item">Remove</button>
            </div>)}
          </section>

          <section className="submit-expense-section">
            <h2>3. Link submission</h2>
            <Field label="Resolved procurement ticket (recommended)" as="select" value={ticketId} disabled={loadingChoices || tickets.length === 0} onChange={(e) => handleTicketChange(e.target.value)}>
              <option value="">No ticket — choose a project below</option>
              {tickets.map((ticket) => <option key={ticket.ticketid} value={ticket.ticketid}>{ticket.subject} · {ticket.projectname || ticket.projectName || ticket.projectid}</option>)}
            </Field>
            <Field label="Project" required={!ticketId} as="select" value={selectedTicket?.projectid || projectId} disabled={Boolean(ticketId) || loadingChoices} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{loadingChoices ? "Loading projects…" : "Select a project"}</option>
              {availableProjects.map((project) => <option key={project.projectid} value={project.projectid}>{project.name}</option>)}
            </Field>
            <p className="submit-expense-help">{tickets.length ? "Resolved tickets are limited to the projects you are allowed to manage." : "No resolved tickets are available; submit against an authorized project."}</p>
          </section>
          <div className="submit-expense-actions"><Link to="/expenses" className="btn btn-secondary">Cancel</Link><Button type="submit" disabled={submitting || scanning}>{submitting ? "Submitting…" : "Submit for Review"}</Button></div>
        </form>
      </Card>
    </div>
  );
}
