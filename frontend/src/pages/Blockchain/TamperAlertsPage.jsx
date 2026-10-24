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
import { PESO_EXACT, tamperReasonKey } from "../../utils/plainLanguage";
import { useLocale } from "../../i18n/LocaleProvider";
import "./TamperAlertsPage.css";

const DATETIME_OPTIONS = { dateStyle: "medium", timeStyle: "short" };
const PAGE_SIZE = 8;
const TABS = [
  { value: "open", labelKey: "tamper.tab_open" },
  { value: "reviewed", labelKey: "tamper.tab_reviewed" },
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
  const { t, formatDate } = useLocale();
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
      .catch((err) => { if (!cancelled) setError(extractErrorMessage(err, t("errors.load_alerts"))); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on tab change only, not on a language change
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
      setResolveError(extractErrorMessage(err, t("errors.save_review")));
    } finally {
      setResolving(false);
    }
  }

  const reviewed = tab === "reviewed";

  return (
    <div className="tamper-page">
      <header className="page-header">
        <div className="page-header-text">
          <h1>{t("nav.tamper_alerts")}</h1>
          <p className="page-header-sub">{t("tamper.subtitle")}</p>
        </div>
      </header>

      <div className="tamper-tabs" role="tablist" aria-label={t("tamper.alert_status")}>
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={tab === item.value}
            className={"tamper-tab" + (tab === item.value ? " tamper-tab-active" : "")}
            onClick={() => changeTab(item.value)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>

      {error && <Banner tone="error" title={error} />}
      {!error && loading && <p className="dashboard-loading">{t("tamper.loading")}</p>}

      {!error && !loading && alerts.length === 0 && (
        <Banner tone="empty" title={reviewed ? t("tamper.none_reviewed") : t("tamper.nothing")}>
          {reviewed ? t("tamper.reviewed_help") : t("tamper.nothing_help")}
        </Banner>
      )}

      {!error && !loading && alerts.length > 0 && (
        <>
          <div className="tamper-toolbar">
            <input
              type="search"
              className="tamper-search"
              placeholder={t("tamper.search_placeholder")}
              aria-label={t("tamper.search_label")}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
            <span className="tamper-count">{filtered.length === 1 ? t("tamper.count_one") : t("tamper.count_other", { count: filtered.length })}</span>
          </div>

          {filtered.length === 0 ? (
            <Banner tone="empty" title={t("tamper.no_match")}>
              {t("tamper.try_different")}
            </Banner>
          ) : (
            <Card className="tamper-table-card">
              <table className="tamper-table">
                <thead>
                  <tr>
                    <th>{t("nav.project")}</th>
                    <th>{t("dashboard.vendor")}</th>
                    <th className="num">{t("dashboard.amount")}</th>
                    <th>{t("tamper.what_happened")}</th>
                    <th>{t("tamper.found")}</th>
                    {reviewed ? <th>{t("tamper.review_col")}</th> : <th aria-label={t("tamper.actions")} />}
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
                              {alert.projectname || t("tamper.view_project")}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{alert.vendorname}</td>
                        <td className="num">{PESO_EXACT.format(alert.amount)}</td>
                        <td className="tamper-reason">
                          {t(tamperReasonKey(alert))}
                          <span className="tamper-state">
                            {alert.restoredat ? (
                              <Badge status="Completed">{t("tamper.back_to_approved")}</Badge>
                            ) : (
                              <Badge status="Overdue">{t("tamper.still_changed")}</Badge>
                            )}
                          </span>
                        </td>
                        <td>{formatDate(alert.detectedat, DATETIME_OPTIONS)}</td>
                        {reviewed ? (
                          <td className="tamper-review">
                            <strong>{alert.resolvedbyname || t("tamper.unknown_user")}</strong>
                            {alert.resolvedbyrole ? ` (${alert.resolvedbyrole})` : ""}
                            <span className="tamper-review-date">{formatDate(alert.resolvedat, DATETIME_OPTIONS)}</span>
                            <span className="tamper-review-note">{alert.resolutionnote}</span>
                          </td>
                        ) : (
                          <td>
                            {ownApproval ? (
                              <span className="tamper-own" title={t("tamper.own_title")}>
                                {t("tamper.own_text")}
                              </span>
                            ) : (
                              <Button variant="secondary" className="btn-sm" onClick={() => openReview(alert)}>
                                {t("tamper.review_btn")}
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
                ← {t("common.previous")}
              </button>
              <span className="tamper-page-status">
                {t("common.page_of", { page: clampedPage, total: totalPages })}
              </span>
              <button
                type="button"
                className="tamper-page-btn"
                disabled={clampedPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t("common.next")} →
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
            <h2 id="tamper-review-title" className="modal-title">{t("tamper.review_title")}</h2>
            <p className="modal-body">
              <strong>{confirmTarget.vendorname}</strong>
              {confirmTarget.projectname ? ` (${confirmTarget.projectname})` : ""} · {PESO_EXACT.format(confirmTarget.amount)}.{" "}
              {t("tamper.review_body")}
            </p>
            <Field
              label={t("tamper.finding_label")}
              required
              as="textarea"
              placeholder={t("tamper.finding_placeholder")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              error={note && note.trim().length < 10 ? t("tamper.note_short") : undefined}
            />
            {resolveError && <Banner tone="error" title={resolveError} />}
            <div className="modal-actions">
              <Button variant="secondary" onClick={closeReview} disabled={resolving}>{t("common.cancel")}</Button>
              <Button onClick={handleConfirmResolve} disabled={resolving || note.trim().length < 10}>
                {resolving ? t("common.saving") : t("tamper.save_review")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
