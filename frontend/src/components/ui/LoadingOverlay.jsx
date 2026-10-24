import { useLocale } from "../../i18n/LocaleProvider";
import "./LoadingOverlay.css";

/**
 * Full-screen blocking overlay for slow actions (OCR scan, submit).
 * Reuses the global .modal-overlay backdrop. Renders nothing when not open.
 */
export function LoadingOverlay({ open, message, detail }) {
  const { t } = useLocale();
  if (!open) return null;
  message = message ?? t("common.working");
  return (
    <div className="modal-overlay loading-overlay" role="alertdialog" aria-modal="true" aria-busy="true" aria-live="assertive">
      <div className="loading-overlay-panel">
        <span className="loading-overlay-spinner" aria-hidden="true" />
        <p className="loading-overlay-message">{message}</p>
        {detail && <p className="loading-overlay-detail">{detail}</p>}
      </div>
    </div>
  );
}
