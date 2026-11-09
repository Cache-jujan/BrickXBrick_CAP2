import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../ui/Badge";
import { progressOf } from "../../utils/openRequests";
import { useLocale } from "../../i18n/LocaleProvider";
import "./RequestDetailModal.css";

const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });

/** A short, readable reference for a request (the first block of its id). */
export function requestRef(request) {
  return String(request?.ticketID || "").split("-")[0].toUpperCase();
}

/**
 * The full summary of one open material request, built from the data the list already holds.
 * Read-only: buying and assigning stay with the Project Manager's ticket queue, so the only
 * actions here are shortcuts (open the project; for a Project Manager, the ticket queue).
 */
export function RequestDetailModal({ request, role, onClose }) {
  const { t, formatDate, formatNumber } = useLocale();
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!request) return null;
  const progress = progressOf(request);
  const share = Math.round((progress.quantityShare ?? 0) * 100);
  const unit = request.unit ? ` ${request.unit}` : "";
  const num = (n) => (formatNumber ? formatNumber(n) : n);
  const left = request.remainingQuantity != null ? Number(request.remainingQuantity) : Math.max(0, progress.requested - progress.bought);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="modal rq-modal" role="dialog" aria-modal="true" aria-labelledby="rq-title" onClick={(e) => e.stopPropagation()}>
        <header className="rq-head">
          <div className="rq-head-text">
            <p className="rq-ref">{t("rq.id")} #{requestRef(request)}</p>
            <h2 id="rq-title" className="rq-title">{request.subject}</h2>
            <p className="rq-sub">{request.projectName}</p>
          </div>
          <div className="rq-head-side">
            <Badge status={request.status} />
            <button ref={closeRef} type="button" className="modal-close" onClick={onClose} aria-label={t("pd.close")}>×</button>
          </div>
        </header>

        <section className="rq-section">
          <h3>{t("rq.item")}</h3>
          <dl className="rq-grid">
            <div><dt>{t("rq.material")}</dt><dd>{request.materialType || "—"}</dd></div>
            <div><dt>{t("rq.store")}</dt><dd>{request.vendorName || t("rq.store_any")}</dd></div>
            <div><dt>{t("rq.quantity")}</dt><dd>{num(progress.requested)}{unit}</dd></div>
            <div><dt>{t("rq.left")}</dt><dd>{num(left)}{unit}</dd></div>
          </dl>
          <div className="rq-progress">
            <div className="rq-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share}>
              <div className="rq-fill" style={{ width: `${share}%` }} />
            </div>
            <span>{t("rq.bought_of", { bought: num(progress.bought), total: num(progress.requested) })}</span>
          </div>
        </section>

        {progress.budget != null && (
          <section className="rq-section">
            <h3>{t("rq.budget")}</h3>
            <dl className="rq-grid rq-grid-3">
              <div><dt>{t("rq.approved_budget")}</dt><dd>{PESO.format(progress.budget)}</dd></div>
              <div><dt>{t("rq.spent")}</dt><dd>{progress.spent != null ? PESO.format(progress.spent) : "—"}</dd></div>
              <div><dt>{t("rq.budget_left")}</dt><dd>{request.remainingBudget != null ? PESO.format(Number(request.remainingBudget)) : "—"}</dd></div>
            </dl>
          </section>
        )}

        <section className="rq-section">
          <h3>{t("rq.people_dates")}</h3>
          <dl className="rq-grid">
            <div><dt>{t("rq.requested_by")}</dt><dd>{request.requestedByName || "—"}</dd></div>
            <div><dt>{t("rq.approved_by")}</dt><dd>{request.approvedByName || "—"}</dd></div>
            <div><dt>{t("rq.requested_on")}</dt><dd>{request.createdAt ? formatDate(request.createdAt) : "—"}</dd></div>
            <div><dt>{t("rq.needed_by")}</dt><dd>{request.neededBy ? formatDate(request.neededBy) : "—"}</dd></div>
          </dl>
        </section>

        {request.description && (
          <section className="rq-section">
            <h3>{t("rq.notes")}</h3>
            <p className="rq-notes">{request.description}</p>
          </section>
        )}

        <footer className="rq-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t("rq.close")}</button>
          {role === "Project Manager" && (
            <Link className="btn btn-secondary" to="/tickets/queue">{t("rq.open_queue")}</Link>
          )}
          <Link className="btn btn-primary" to={`/projects/${request.projectID}`}>{t("rq.open_project")}</Link>
        </footer>
      </div>
    </div>
  );
}
