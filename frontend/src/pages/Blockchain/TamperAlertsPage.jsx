import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listTamperAlerts, resolveTamperAlert } from "../../api/blockchainApi";
import { extractErrorMessage } from "../../api/client";
import { Card } from "../../components/ui/Card";
import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const DATETIME = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

export function TamperAlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
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

  async function handleResolve(alertId) {
    setResolvingId(alertId);
    setResolveError("");
    try {
      await resolveTamperAlert(alertId);
      // A resolved alert drops off this list entirely — the same filter
      // the backend applies (resolvedAt IS NULL).
      setAlerts((prev) => prev.filter((a) => a.alertid !== alertId));
    } catch (err) {
      setResolveError(extractErrorMessage(err, "Couldn't resolve this alert."));
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Tamper Alerts</h1>
      <p style={{ marginBottom: 16 }}>
        Open blockchain tamper alerts across all projects. Investigate the flagged expense,
        then mark it investigated once resolved — the flagged expense itself stays
        permanently marked TamperDetected, since the event genuinely happened.
      </p>

      {error && <Banner tone="error" title={error} />}
      {resolveError && <Banner tone="error" title={resolveError} />}

      {!error && loading && <p className="dashboard-loading">Loading alerts…</p>}

      {!error && !loading && alerts.length === 0 && (
        <Banner tone="empty" title="No open tamper alerts">
          Every flagged expense has been investigated and resolved.
        </Banner>
      )}

      {!error && !loading && alerts.length > 0 && (
        <Card className="users-table-card">
          <table className="users-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Vendor</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Detected</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr key={alert.alertid}>
                  <td>
                    {alert.projectid ? (
                      <Link to={`/projects/${alert.projectid}`}>{alert.projectname || "View project"}</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{alert.vendorname}</td>
                  <td>{PESO.format(alert.amount)}</td>
                  <td>{reasonFor(alert)}</td>
                  <td>{DATETIME.format(new Date(alert.detectedat))}</td>
                  <td>
                    <Button
                      variant="secondary"
                      disabled={resolvingId === alert.alertid}
                      onClick={() => handleResolve(alert.alertid)}
                    >
                      {resolvingId === alert.alertid ? "Resolving…" : "Mark Investigated"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}