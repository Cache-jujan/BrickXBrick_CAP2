import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listTamperAlerts, resolveTamperAlert } from "../../api/blockchainApi";
import { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Card } from "../../components/ui/Card";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Field } from "../../components/ui/Field";
import { PESO_EXACT, tamperReason } from "../../utils/plainLanguage";
import "./TamperAlertsPage.css";

const DATETIME = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });
const PAGE_SIZE = 8;
const TABS = [
  { value: "open", label: "To review" },
  { value: "reviewed", label: "Reviewed" },
];

// FUNCTION F12 — Blockchain Tamper Alerts (GM / System Administrator)
// Reads GET /api/blockchain/alerts?status=open|reviewed and writes via
// PATCH /api/blockchain/alerts/:id/resolve { note }.
// Reviewing an alert never hides it: it moves to "Reviewed" with who, when
// and why, and the expense keeps its "Changed after approval" status until
// its data matches the approved copy again. Whoever approved the expense
// can't review its alert. The server re-creates an alert if it is deleted.
export function TamperAlertsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState("open");
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [confirmTarget, setConfirmTarget] = useState(null); // the alert object, or null
  const [note, setNote] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    listTamperAlerts(tab)
      .then((data) => { if (!cancelled) setAlerts(data); })
      .catch((err) => { if (!cancelled) setError(extractErrorMessage(err, "Couldn't load tamper alerts.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tab]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return alerts;
    return alerts.filter((a) =>
      (a.vendorname || "").toLowerCase().includes(q) ||
      (a.projectname || "").toLowerCase().includes(q)
    );
  }, [alerts, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const pageAlerts = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  function changeTab(value) {
    setTab(value);
    setSearch("");
    setPage(1);
  }

  function openReview(alert) {
    setNote("");
    setResolveError("");
    setConfirmTarget(alert);
  }

  function closeReview() {
    if (resolving) return;
    setConfirmTarget(null);
  }

  async function handleConfirmResolve() {
    const alert = confirmTarget;
    if (!alert || note.trim().length < 10) return;
    setResolving(true);
    setResolveError("");
    try {
      await resolveTamperAlert(alert.alertid, note.trim());
      setAlerts((prev) => prev.filter((a) => a.alertid !== alert.alertid));
      setConfirmTarget(null);
    } catch (err) {
      setResolveError(extractErrorMessage(err, "Couldn't save the review."));
    } finally {
      setResolving(false);
    }
  }

  const reviewed = tab === "reviewed";

  return (
    <div className="tamper-page">
      <header className="page-header">
        <div className="page-header-text">
          <h1>Tamper Alerts</h1>
          <p className="page-header-sub">
            Approved expenses whose record no longer matches the copy secured on the blockchain.
          </p>
        </div>
      </header>

      <div className="tamper-tabs" role="tablist" aria-label="Alert status">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={tab === t.value}
            className={"tamper-tab" + (tab === t.value ? " tamper-tab-active" : "")}
            onClick={() => changeTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <Banner tone="error" title={error} />}
      {!error && loading && <p className="dashboard-loading">Loading alerts…</p>}

      {!error && !loading && alerts.length === 0 && (
        <Banner tone="empty" title={reviewed ? "No reviewed alerts yet" : "Nothing to review"}>
          {reviewed
            ? "Alerts appear here once someone has reviewed them, with who did it, when and why."
            : "No approved expense has been changed since it was approved."}
        </Banner>
      )}

      {!error && !loading && alerts.length > 0 && (
        <>
          <div className="tamper-toolbar">
            <input
              type="search"
              className="tamper-search"
              placeholder="Search by vendor or project"
              aria-label="Search alerts"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
            <span className="tamper-count">{filtered.length} {filtered.length === 1 ? "alert" : "alerts"}</span>
          </div>

          {filtered.length === 0 ? (
            <Banner tone="empty" title="No alerts match your search">
              Try a different vendor or project name.
            </Banner>
          ) : (
            <Card className="tamper-table-card">
              <table className="tamper-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Vendor</th>
                    <th className="num">Amount</th>
                    <th>What happened</th>
                    <th>Found</th>
                    {reviewed ? <th>Review</th> : <th aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {pageAlerts.map((alert) => {
                    const ownApproval = alert.approvedby && alert.approvedby === user.id;
                    return (
                      <tr key={alert.alertid}>
                        <td>
                          {alert.projectid ? (
                            <Link to={`/projects/${alert.projectid}`} className="tamper-project-link">
                              {alert.projectname || "View project"}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{alert.vendorname}</td>
                        <td className="num">{PESO_EXACT.format(alert.amount)}</td>
                        <td className="tamper-reason">
                          {tamperReason(alert)}
                          <span className="tamper-state">
                            {alert.restoredat ? (
                              <Badge status="Completed">Back to approved values</Badge>
                            ) : (
                              <Badge status="Overdue">Still changed</Badge>
                            )}
                          </span>
                        </td>
                        <td>{DATETIME.format(new Date(alert.detectedat))}</td>
                        {reviewed ? (
                          <td className="tamper-review">
                            <strong>{alert.resolvedbyname || "Unknown user"}</strong>
                            {alert.resolvedbyrole ? ` (${alert.resolvedbyrole})` : ""}
                            <span className="tamper-review-date">{DATETIME.format(new Date(alert.resolvedat))}</span>
                            <span className="tamper-review-note">{alert.resolutionnote}</span>
                          </td>
                        ) : (
                          <td>
                            {ownApproval ? (
                              <span className="tamper-own" title="You approved this expense, so someone else must review its alert.">
                                You approved this; another reviewer needed
                              </span>
                            ) : (
                              <Button variant="secondary" className="btn-sm" onClick={() => openReview(alert)}>
                                Review
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}

          {totalPages > 1 && (
            <div className="tamper-pagination">
              <button
                type="button"
                className="tamper-page-btn"
                disabled={clampedPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Previous
              </button>
              <span className="tamper-page-status">
                Page {clampedPage} of {totalPages}
              </span>
              <button
                type="button"
                className="tamper-page-btn"
                disabled={clampedPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {confirmTarget && (
        <div className="modal-overlay" role="presentation" onClick={closeReview}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tamper-review-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="tamper-review-title" className="modal-title">Review this alert</h2>
            <p className="modal-body">
              <strong>{confirmTarget.vendorname}</strong>
              {confirmTarget.projectname ? ` (${confirmTarget.projectname})` : ""} · {PESO_EXACT.format(confirmTarget.amount)}.
              The alert moves to Reviewed with your name, the time and your explanation, and every other General
              Manager and System Administrator is notified. It can't be edited or removed afterwards, and the expense
              keeps its "Changed after approval" status.
            </p>
            <Field
              label="What did you find?"
              required
              as="textarea"
              placeholder="e.g. Checked with the purchaser; the amount was corrected to match the official receipt."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              error={note && note.trim().length < 10 ? "Write at least 10 characters." : undefined}
            />
            {resolveError && <Banner tone="error" title={resolveError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={closeReview} disabled={resolving}>Cancel</Button>
              <Button onClick={handleConfirmResolve} disabled={resolving || note.trim().length < 10}>
                {resolving ? "Saving…" : "Save review"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
