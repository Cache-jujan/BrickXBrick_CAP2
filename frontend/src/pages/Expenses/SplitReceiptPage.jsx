import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { scanReceipt } from "../../api/expensesApi";
import { previewAllocation, submitAllocation } from "../../api/allocationsApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Banner } from "../../components/ui/Banner";
import { BackLink } from "../../components/ui/BackLink";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { LoadingOverlay } from "../../components/ui/LoadingOverlay";
import { ReceiptLink, useSignedReceiptUrl } from "../../components/ui/ReceiptLink";
import { EMPTY_DRAFT, draftFromScan, isSupportedReceipt } from "./SubmitExpensePage";
import "./SubmitExpensePage.css";
import "./SplitReceiptPage.css";

// F8 split receipt (UC-08-01), GM/PM backup actors. One receipt is scanned; the
// SERVER splits each line across the open Material Requests for that material,
// oldest request first, and saves one expense per request. This page only
// collects the receipt, shows the server's preview, and lets the actor exclude
// a request ("Not for this request") or move a fee/VAT line to another portion.

const blankDraft = () => ({ ...EMPTY_DRAFT, lineItems: [{ ...EMPTY_DRAFT.lineItems[0] }] });
const peso = (value) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isNonNegativeNumber = (value) => value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
const toCents = (value) => Math.round(Number(value) * 100);

export function SplitReceiptPage() {
  const { user } = useAuth();
  const cameraInput = useRef(null);
  const imageInput = useRef(null);
  const pdfInput = useRef(null);
  const busyRef = useRef(false);

  const [draft, setDraft] = useState(blankDraft);
  const signedReceiptUrl = useSignedReceiptUrl(draft.receiptImageURL);
  const [receiptName, setReceiptName] = useState("");
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pageError, setPageError] = useState("");
  const [ocrNotice, setOcrNotice] = useState("");

  // Allocation state. `allocating` turns on after "Preview split"; from then on
  // the preview re-runs whenever the lines, exclusions or fee moves change.
  const [allocating, setAllocating] = useState(false);
  const [excluded, setExcluded] = useState([]);
  const [feeTargets, setFeeTargets] = useState({});
  const [plan, setPlan] = useState(null);
  const [known, setKnown] = useState({});
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [submitProblems, setSubmitProblems] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [result, setResult] = useState(null);

  function setField(name, value) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  function updateLineItem(index, name, value) {
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((item, i) => (i === index ? { ...item, [name]: value } : item)),
    }));
  }

  function addLineItem() {
    setDraft((current) => ({
      ...current,
      lineItems: [...current.lineItems, { description: "", amount: "", quantity: "", unitPrice: "" }],
    }));
  }

  function removeLineItem(index) {
    setDraft((current) => ({
      ...current,
      lineItems: current.lineItems.length <= 1 ? current.lineItems : current.lineItems.filter((_, i) => i !== index),
    }));
  }

  // Every line needs a quantity (0 for delivery, VAT, fees): the split is by quantity.
  const namedLineItems = draft.lineItems.filter((item) => item.description.trim());
  const validLineItems = namedLineItems.filter(
    (item) => isNonNegativeNumber(item.amount) && isNonNegativeNumber(item.quantity)
  );
  const allLinesValid = namedLineItems.length > 0 && validLineItems.length === namedLineItems.length;
  const amountIsValid = isNonNegativeNumber(draft.amount);

  const linesCents = validLineItems.reduce((sum, item) => sum + toCents(item.amount), 0);
  const totalMatches = amountIsValid && allLinesValid && linesCents === toCents(draft.amount);

  const splitLines = useMemo(
    () =>
      validLineItems.map((item) => ({
        description: item.description.trim(),
        quantity: Number(item.quantity),
        amount: Number(item.amount),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(validLineItems)]
  );

  const readyToPreview = Boolean(
    draft.receiptImageURL && draft.vendorName.trim() && draft.receiptDate && amountIsValid && allLinesValid && totalMatches
  );

  // Editing the receipt or choosing a new one invalidates the old preview.
  function resetAllocation() {
    setAllocating(false);
    setExcluded([]);
    setFeeTargets({});
    setPlan(null);
    setKnown({});
    setPreviewError("");
    setSubmitProblems([]);
  }

  async function handleReceiptPick(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busyRef.current) return;

    setPageError("");
    setOcrNotice("");
    setReceiptName("");
    setResult(null);
    resetAllocation();
    setDraft(blankDraft());
    if (!isSupportedReceipt(file)) {
      setPageError("Choose a JPG, PNG, or PDF receipt. HEIC and other formats are not accepted yet.");
      return;
    }

    setReceiptName(file.name);
    busyRef.current = true;
    setScanning(true);
    try {
      const scan = await scanReceipt(file);
      setDraft(draftFromScan(scan));
      setOcrNotice(scan.ocrError || "");
      if (!scan.ocrError && scan.confidence === "low") {
        setOcrNotice("OCR confidence is low. Check every extracted value before splitting.");
      }
    } catch (error) {
      setPageError(extractErrorMessage(error, "Receipt upload failed. Please try again."));
    } finally {
      busyRef.current = false;
      setScanning(false);
    }
  }

  // Live preview. Debounced so typing in a quantity doesn't fire a request per key.
  useEffect(() => {
    if (!allocating || result) return undefined;
    if (!allLinesValid) {
      setPlan(null);
      return undefined;
    }
    let cancelled = false;
    setPreviewing(true);
    setPreviewError("");
    const timer = setTimeout(() => {
      previewAllocation(splitLines, { excludeTicketIDs: excluded, feeTargets })
        .then((next) => {
          if (cancelled) return;
          setPlan(next);
          // Remember every request we have seen so an excluded one stays listed
          // and can be switched back on.
          setKnown((prev) => {
            const merged = { ...prev };
            for (const p of next.portions) {
              merged[p.ticketID] = { ticketID: p.ticketID, projectName: p.projectName, materialType: p.materialType };
            }
            return merged;
          });
        })
        .catch((error) => {
          if (cancelled) return;
          setPlan(null);
          setPreviewError(extractErrorMessage(error, "Couldn't preview the split."));
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [allocating, result, allLinesValid, splitLines, excluded, feeTargets, refreshKey]);

  // Nothing matched an open request: the Site Manager may have filed one since,
  // so re-run the preview instead of making the user rescan the receipt.
  function retryPreview() {
    setSubmitProblems([]);
    setRefreshKey((k) => k + 1);
  }

  function toggleExcluded(ticketID, value) {
    setSubmitProblems([]);
    setExcluded((prev) => (value ? [...prev, ticketID] : prev.filter((id) => id !== ticketID)));
  }

  function moveFee(lineIndex, ticketID) {
    setFeeTargets((prev) => ({ ...prev, [String(lineIndex)]: ticketID }));
  }

  const canSubmit = Boolean(
    plan?.ok && draft.category && readyToPreview && !previewing && !scanning && !submitting && !result
  );

  async function handleSubmit() {
    if (!canSubmit || busyRef.current) return;
    busyRef.current = true;
    setSubmitting(true);
    setPageError("");
    setSubmitProblems([]);
    try {
      const saved = await submitAllocation({
        receiptImageURL: draft.receiptImageURL,
        vendorName: draft.vendorName.trim(),
        receiptDate: draft.receiptDate,
        category: draft.category,
        tin: draft.tin.trim() || null,
        birPermitNumber: draft.birPermitNumber.trim() || null,
        birNumber: draft.birNumber.trim() || null,
        receiptTotal: Number(draft.amount),
        lineItems: splitLines,
        excludeTicketIDs: excluded,
        feeTargets,
      });
      setResult(saved);
    } catch (error) {
      const problems = error?.response?.data?.details?.problems;
      if (Array.isArray(problems)) {
        // The requests changed since the preview (another receipt filled one).
        setSubmitProblems(problems);
        setRefreshKey((k) => k + 1);
      } else {
        setPageError(extractErrorMessage(error, "Split submission failed. Please check the details and retry."));
      }
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  }

  function startOver() {
    setResult(null);
    resetAllocation();
    setDraft(blankDraft());
    setReceiptName("");
    setOcrNotice("");
    setPageError("");
  }

  if (!user || !["General Manager", "Project Manager"].includes(user.role)) {
    return <Banner tone="error" title="Not authorized">This page is for General Managers and Project Managers.</Banner>;
  }

  // ---- After a successful submit ------------------------------------------
  if (result) {
    const name = (id) => known[id]?.projectName ?? "Request";
    const screening = Object.values(result.screening ?? {});
    const flagged = screening.filter((s) => (s.flagTypes ?? []).length > 0).length;
    const notScreened = screening.filter((s) => s.flagTypes === null).length;
    return (
      <div className="submit-expense-page">
        <div className="submit-expense-header">
          <div>
            <h1>Split saved</h1>
            <p className="submit-expense-subtitle">
              {result.expenses.length} Pending expenses were created from one receipt. Each goes to review separately.
            </p>
          </div>
        </div>
        <Card className="submit-expense-card">
          <section className="submit-expense-section">
            <h2>Completed requests</h2>
            {result.resolvedTicketIDs.length === 0 ? <p>None</p> : (
              <ul className="split-result-list">
                {result.resolvedTicketIDs.map((id) => <li key={id}>✓ {name(id)}</li>)}
              </ul>
            )}
            <h2>Still open</h2>
            {result.stillOpenTicketIDs.length === 0 ? <p>None</p> : (
              <ul className="split-result-list">
                {result.stillOpenTicketIDs.map((id) => <li key={id}>• {name(id)}</li>)}
              </ul>
            )}
            {flagged > 0 && <Banner tone="warning" title="Flagged for PM review">{flagged} portion(s) were flagged by fraud screening.</Banner>}
            {notScreened > 0 && <Banner tone="error" title="Screening didn't run">Fraud screening didn't run for {notScreened} portion(s). Tell the PM.</Banner>}
          </section>
        </Card>
        <div className="submit-expense-footer">
          <Link to="/expenses" className="btn btn-primary">Back to expenses</Link>
          <Button type="button" variant="secondary" onClick={startOver}>Split another receipt</Button>
        </div>
      </div>
    );
  }

  const needsRetry = Boolean(plan && (plan.uncovered.length + plan.unmatched.length > 0 || plan.portions.length === 0));
  const portionByTicket = new Map((plan?.portions ?? []).map((p) => [p.ticketID, p]));
  const requestIDs = [
    ...(plan?.portions ?? []).map((p) => p.ticketID),
    ...excluded.filter((id) => !portionByTicket.has(id)),
  ];
  const feeLines = (plan?.portions ?? []).flatMap((p) =>
    p.lines.filter((line) => Number(line.quantity) === 0).map((line) => ({ ...line, ticketID: p.ticketID }))
  );
  const warningFor = (ticketID) => plan?.warnings?.find((w) => w.type === "OVER_BUDGET" && w.ticketID === ticketID);

  return (
    <div className="submit-expense-page">
      <LoadingOverlay
        open={scanning || submitting}
        message={scanning ? "Reading receipt…" : "Submitting split…"}
        detail={scanning ? "Uploading and running OCR. This can take a few seconds." : "Creating one expense per request."}
      />
      <div className="submit-expense-header">
        <div>
          <BackLink to="/expenses">Back to expenses</BackLink>
          <h1>Split Receipt</h1>
          <p className="submit-expense-subtitle">
            One receipt for several open Material Requests. The system splits each line across the requests for that
            material, oldest request first, and creates one expense per request.
          </p>
        </div>
        <span className="submit-expense-role">{user.role}</span>
      </div>

      {pageError && <Banner tone="error" title="Could not continue">{pageError}</Banner>}
      {ocrNotice && <Banner tone="warning" title="Review the receipt carefully">{ocrNotice}</Banner>}

      <Card className="submit-expense-card">
        <section className="submit-expense-section" aria-labelledby="split-receipt-heading">
          <div className="submit-expense-section-heading">
            <div>
              <h2 id="split-receipt-heading">1. Add receipt</h2>
              <p>Choose an image or upload a PDF (10 MB maximum).</p>
            </div>
            {receiptName && <span className="submit-expense-filename">{receiptName}</span>}
          </div>

          <input ref={cameraInput} className="submit-expense-hidden-input" type="file" accept="image/jpeg,image/png" capture="environment" onChange={handleReceiptPick} />
          <input ref={imageInput} className="submit-expense-hidden-input" type="file" accept="image/jpeg,image/png" onChange={handleReceiptPick} />
          <input ref={pdfInput} className="submit-expense-hidden-input" type="file" accept="application/pdf,.pdf" onChange={handleReceiptPick} />

          <div className="submit-expense-upload-actions">
            <Button type="button" onClick={() => cameraInput.current?.click()} disabled={scanning}>Capture with camera</Button>
            <Button type="button" variant="secondary" onClick={() => imageInput.current?.click()} disabled={scanning}>Choose image</Button>
            <Button type="button" variant="secondary" onClick={() => pdfInput.current?.click()} disabled={scanning}>Choose PDF</Button>
          </div>

          {draft.receiptImageURL && (
            <div className="submit-expense-receipt-preview">
              {receiptName.toLowerCase().endsWith(".pdf") ? (
                <iframe className="submit-expense-pdf-preview" title="Uploaded receipt PDF preview" src={signedReceiptUrl} />
              ) : (
                <img className="submit-expense-image-preview" src={signedReceiptUrl} alt="Uploaded receipt preview" />
              )}
              <ReceiptLink className="submit-expense-receipt-link" url={draft.receiptImageURL}>
                Open the uploaded receipt separately
              </ReceiptLink>
            </div>
          )}
        </section>
      </Card>

      <Card className="submit-expense-card">
        <section className="submit-expense-section" aria-labelledby="split-review-heading">
          <div className="submit-expense-section-heading">
            <div>
              <h2 id="split-review-heading">2. Review and correct extracted fields</h2>
              <p>The line quantities drive the split, so check them against the paper receipt.</p>
            </div>
          </div>

          <div className="submit-expense-fields">
            <Field label="Vendor / store name" required value={draft.vendorName} onChange={(e) => setField("vendorName", e.target.value)} />
            <Field label="Receipt total (₱)" required type="number" min="0" step="0.01" value={draft.amount} onChange={(e) => setField("amount", e.target.value)} />
            <Field label="Receipt date" required type="date" value={draft.receiptDate} onChange={(e) => setField("receiptDate", e.target.value)} />
            <Field as="select" label="Expense category" required value={draft.category} onChange={(e) => setField("category", e.target.value)}>
              <option value="Materials">Materials</option>
              <option value="Equipment">Equipment</option>
              <option value="Other">Other</option>
            </Field>
            <Field label="TIN" value={draft.tin} onChange={(e) => setField("tin", e.target.value)} />
            <Field label="BIR permit number" value={draft.birPermitNumber} onChange={(e) => setField("birPermitNumber", e.target.value)} />
            <Field label="OR / SI number" value={draft.birNumber} onChange={(e) => setField("birNumber", e.target.value)} />
          </div>

          <div className="submit-expense-items-heading">
            <div>
              <h3>Receipt line items</h3>
              <p>Use quantity 0 for delivery, VAT and fees; they ride along with a portion.</p>
            </div>
            <Button type="button" variant="secondary" onClick={addLineItem}>Add item</Button>
          </div>
          <div className="submit-expense-items">
            {draft.lineItems.map((item, index) => (
              <div className="submit-expense-item-row" key={`item-${index}`}>
                <Field label={`Item ${index + 1}`} required value={item.description} onChange={(e) => updateLineItem(index, "description", e.target.value)} placeholder="Description" />
                <Field label="Item amount (₱)" required type="number" min="0" step="0.01" value={item.amount} onChange={(e) => updateLineItem(index, "amount", e.target.value)} />
                <Field label="Quantity (0 for fees)" required type="number" min="0" step="0.01" value={item.quantity} onChange={(e) => updateLineItem(index, "quantity", e.target.value)} />
                <Button type="button" variant="ghost" className="submit-expense-remove-item" onClick={() => removeLineItem(index)} disabled={draft.lineItems.length <= 1} aria-label={`Remove item ${index + 1}`}>Remove</Button>
              </div>
            ))}
          </div>

          {allLinesValid && amountIsValid && !totalMatches && (
            <Banner tone="warning" title="Lines don't add up to the receipt total">
              Lines total {peso(linesCents / 100)} but the receipt total is {peso(draft.amount)}. Fix a line or the total.
            </Banner>
          )}

          {!allocating && (
            <div className="submit-expense-footer">
              <p>Next, the system shows how this receipt would be split. Nothing is saved yet.</p>
              <Button type="button" disabled={!readyToPreview} onClick={() => setAllocating(true)}>Preview split</Button>
            </div>
          )}
        </section>
      </Card>

      {allocating && (
        <Card className="submit-expense-card">
          <section className="submit-expense-section" aria-labelledby="split-allocate-heading">
            <div className="submit-expense-section-heading">
              <div>
                <h2 id="split-allocate-heading">3. Allocate to requests</h2>
                <p>Each request below becomes one Pending expense. Untick "Not for this request" to leave one out.</p>
              </div>
              {previewing && <span className="submit-expense-progress" role="status">Updating…</span>}
            </div>

            {previewError && (
              <Banner
                tone="error"
                title="Couldn't preview the split"
                action={<Button type="button" variant="secondary" onClick={retryPreview} disabled={previewing}>Retry</Button>}
              >
                {previewError}
              </Banner>
            )}
            {submitProblems.length > 0 && (
              <Banner tone="warning" title="The open requests changed since the preview">
                {submitProblems.join(" ")} The preview has been refreshed.
              </Banner>
            )}
            {plan && !plan.ok && plan.problems.length > 0 && (
              <Banner
                tone="error"
                title="This receipt can't be submitted yet"
                action={needsRetry ? (
                  <Button type="button" variant="secondary" onClick={retryPreview} disabled={previewing}>
                    {previewing ? "Checking…" : "Retry"}
                  </Button>
                ) : undefined}
              >
                <ul className="split-problems">{plan.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
                {needsRetry && <p className="split-muted">If a Site Manager just filed the missing request, retry to pick it up. No need to rescan.</p>}
              </Banner>
            )}
            {plan?.warnings?.length > 0 && (
              <Banner tone="warning" title="Over budget">
                One or more portions exceed the remaining budget of their request. You can still submit; the PM will see it.
              </Banner>
            )}

            <div className="split-portions">
              {requestIDs.map((ticketID) => {
                const portion = portionByTicket.get(ticketID);
                const isExcluded = excluded.includes(ticketID);
                const info = known[ticketID];
                const warning = warningFor(ticketID);
                return (
                  <div key={ticketID} className={`split-portion${isExcluded ? " split-portion-excluded" : ""}`}>
                    <div className="split-portion-head">
                      <div>
                        <strong>{portion?.projectName ?? info?.projectName ?? "Request"}</strong>
                        <span className="split-muted"> · {portion?.materialType ?? info?.materialType}</span>
                      </div>
                      <label className="split-exclude">
                        <input type="checkbox" checked={isExcluded} onChange={(e) => toggleExcluded(ticketID, e.target.checked)} />
                        Not for this request
                      </label>
                    </div>
                    {portion && !isExcluded && (
                      <>
                        <div className="split-portion-summary">
                          <span>{portion.quantity} units</span>
                          <span>{peso(portion.amount)}</span>
                          <span className={portion.resolvesTicket ? "split-done" : "split-open"}>
                            {portion.resolvesTicket ? "Completes this request" : `Request stays open (${portion.remainingAfter} left)`}
                          </span>
                          {warning && <span className="split-over">Over budget (₱ left {warning.remainingBudget})</span>}
                        </div>
                        <table className="split-lines">
                          <thead><tr><th>Line</th><th>Qty</th><th>Amount</th></tr></thead>
                          <tbody>
                            {portion.lines.map((line) => (
                              <tr key={`${line.lineIndex}-${line.quantity}`}>
                                <td>{line.description}</td>
                                <td>{line.quantity}</td>
                                <td>{peso(line.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                );
              })}
              {plan && requestIDs.length === 0 && (
                <Banner
                  tone="info"
                  title="No open requests match this receipt"
                  action={<Button type="button" variant="secondary" onClick={retryPreview} disabled={previewing}>{previewing ? "Checking…" : "Retry"}</Button>}
                >
                  Ask the Site Manager to file a Material Request for these materials, then retry.
                </Banner>
              )}
            </div>

            {plan && plan.uncovered.length + plan.unmatched.length > 0 && (
              <div className="split-uncovered">
                <h3>Not covered by any open request</h3>
                <ul>
                  {[...plan.unmatched, ...plan.uncovered].map((line, i) => (
                    <li key={i}>{line.description} · qty {line.quantity} · {peso(line.amount)}</li>
                  ))}
                </ul>
              </div>
            )}

            {feeLines.length > 0 && (plan?.portions.length ?? 0) > 1 && (
              <div className="split-fees">
                <h3>Delivery, VAT and fees</h3>
                <p className="split-muted">These ride on the oldest request by default. Move one to a different request if needed.</p>
                {feeLines.map((line) => (
                  <Field
                    key={line.lineIndex}
                    as="select"
                    label={`${line.description} (${peso(line.amount)})`}
                    value={line.ticketID}
                    onChange={(e) => moveFee(line.lineIndex, e.target.value)}
                  >
                    {plan.portions.map((p) => (
                      <option key={p.ticketID} value={p.ticketID}>{p.projectName} · {p.materialType}</option>
                    ))}
                  </Field>
                ))}
              </div>
            )}

            {plan && (
              <p className="split-totals">
                Allocated {peso(plan.allocated)} of {peso(plan.linesTotal)}
              </p>
            )}

            <div className="submit-expense-footer">
              <p>Submitting creates one Pending expense per request. Approval and blockchain recording are separate steps.</p>
              <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
                {submitting ? "Submitting…" : "Submit split for approval"}
              </Button>
            </div>
          </section>
        </Card>
      )}
    </div>
  );
}
