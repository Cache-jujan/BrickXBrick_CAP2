import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listTamperAlerts, resolveTamperAlert } from "../../api/blockchainApi";
import { extractErrorMessage } from "../../api/client";
import { Card } from "../../components/ui/Card";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import "./TamperAlertsPage.css";

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const DATETIME = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

const PAGE_SIZE = 8;

// FUNCTION F12 — Blockchain Tamper Alerts (GM / System Administrator)
// STATUS: IMPLEMENTED — reads GET /api/blockchain/alerts (open alerts only,
// per its own WHERE resolvedAt IS NULL filter) and writes via
// PATCH /api/blockchain/alerts/:id/resolve. Search/pagination below are
// client-side only — the backend has no query params for this endpoint yet.
export function TamperAlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [confirmTarget, setConfirmTarget] = useState(null); // the alert object, or null
  const [resolvingId, setResolvingId] = useState(null);
  const [resolveError, setResolveError] = useState("");

  useEffect(() => {
    loadAlerts();
  }, []);

  function loadAlerts() {
    setLoading(true);
    setError("");
    listTamperAlerts()
      .then(setAlerts)
      .catch((err) => setError(extractErrorMessage(err, "Couldn't load tamper alerts.")))
      .finally(() => setLoading(false));
  }

  function reasonFor(alert) {
    if (!alert.onchainhash || alert.onchainhash === "MISSING") {
      return "On-chain transaction record could not be found (likely a chain reorg dropped it)";
    }
    return "Recomputed hash does not match the stored on-chain value";
  }

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

  function handleSearchChange(value) {
    setSearch(value);
    setPage(1);
  }

  async function handleConfirmResolve() {
    const alert = confirmTarget;
    if (!alert) return;
    setResolvingId(alert.alertid);
    setResolveError("");
    try {
      await resolveTamperAlert(alert.alertid);
      setAlerts((prev) => prev.filter((a) => a.alertid !== alert.alertid));
      setConfirmTarget(null);
    } catch (err) {
      setResolveError(extractErrorMessage(err, "Couldn't resolve this alert."));
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="tamper-page">
      <div className="tamper-header">
        <div>
          <h1>Tamper Alerts</h1>
          <p className="tamper-subtitle">
            Open blockchain tamper alerts across all projects. Investigate the flagged expense,
            then mark it investigated once resolved — the expense itself stays permanently
            marked <strong>TamperDetected</strong>, since the event genuinely happened.
          </p>
        </div>
        {!loading && !error && alerts.length > 0 && (
          <span className="tamper-count-pill">{alerts.length} open</span>
        )}
      </div>

      {error && <Banner tone="error" title={error} />}
      {resolveError && <Banner tone="error" title={resolveError} />}

      {!error && loading && <p className="dashboard-loading">Loading alerts…</p>}

      {!error && !loading && alerts.length === 0 && (
        <Banner tone="empty" title="No open tamper alerts">
          Every flagged expense has been investigated and resolved.
        </Banner>
      )}

      {!error && !loading && alerts.length > 0 && (
        <>
          <div className="tamper-toolbar">
            <input
              type="search"
              className="tamper-search"
              placeholder="Search by vendor or project…"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
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
                    <th>Amount</th>
                    <th>Reason</th>
                    <th>Detected</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {pageAlerts.map((alert) => (
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
                      <td>{PESO.format(alert.amount)}</td>
                      <td className="tamper-reason">{reasonFor(alert)}</td>
                      <td>{DATETIME.format(new Date(alert.detectedat))}</td>
                      <td>
                        <Button
                          variant="secondary"
                          disabled={resolvingId === alert.alertid}
                          onClick={() => setConfirmTarget(alert)}
                        >
                          Mark Investigated
                        </Button>
                      </td>
                    </tr>
                  ))}
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
        <div className="tamper-modal-overlay" role="presentation" onClick={() => setConfirmTarget(null)}>
          <div
            className="tamper-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tamper-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="tamper-modal-title" className="tamper-modal-title">Mark this alert investigated?</h2>
            <p className="tamper-modal-body">
              This confirms that <strong>{confirmTarget.vendorname}</strong>
              {confirmTarget.projectname ? ` (${confirmTarget.projectname})` : ""} has been reviewed.
              The alert will drop off this list, but the underlying expense keeps its
              permanent <strong>TamperDetected</strong> status.
            </p>
            <div className="tamper-modal-actions">
              <Button variant="secondary" onClick={() => setConfirmTarget(null)} disabled={resolvingId === confirmTarget.alertid}>
                Cancel
              </Button>
              <Button onClick={handleConfirmResolve} disabled={resolvingId === confirmTarget.alertid}>
                {resolvingId === confirmTarget.alertid ? "Resolving…" : "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
