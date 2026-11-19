import { Button } from "../ui/Button";
import { useReceiptScans } from "../../context/ReceiptScanContext";
import { useLocale } from "../../i18n/LocaleProvider";
import "./ReceiptScanTray.css";

/**
 * The receipts being read (or already read) in the background, for one page.
 * The user keeps working while they are read: pick "Review" on a finished one to
 * load it into the form, or "Enter by hand" when the server could not read it.
 *
 * @param {{ mode: "submit"|"split", activeScanID: string, onOpen: (scan: object) => void }} props
 */
export function ReceiptScanTray({ mode, activeScanID, onOpen, onCancelOpen }) {
  const { t } = useLocale();
  const { scans, dismissScan } = useReceiptScans();
  const rows = scans.filter((s) => s.context?.source === "web" && s.context?.mode === mode);
  if (rows.length === 0) return null;

  return (
    <div className="scan-tray" aria-label={t("scan.tray_title")}>
      <div className="scan-tray-head">
        <h3>{t("scan.tray_title")}</h3>
        <p>{t("scan.tray_help")}</p>
      </div>
      <ul className="scan-tray-list">
        {rows.map((scan) => {
          const name = scan.context?.fileName || t("scan.this_receipt");
          const open = scan.scanID === activeScanID;
          // The server rejected the file as not a receipt: no manual entry, just the reason.
          const notReceipt = Boolean(scan.result && scan.result.notReceipt);
          return (
            <li key={scan.scanID} className={`scan-row scan-row-${scan.status.toLowerCase()}${open ? " scan-row-open" : ""}`}>
              <span className="scan-row-name" title={name}>{name}</span>
              <span className="scan-row-status" role="status" title={notReceipt ? scan.errorMessage || undefined : undefined}>
                {scan.status === "Scanning" && <><span className="scan-spinner" aria-hidden="true" />{t("scan.status_scanning")}</>}
                {scan.status === "Ready" && t("scan.status_ready")}
                {scan.status === "Failed" && (notReceipt ? t("scan.status_not_receipt") : t("scan.status_failed"))}
              </span>
              <span className="scan-row-actions">
                {scan.status === "Ready" && (
                  <Button type="button" variant={open ? "secondary" : "primary"} disabled={open} onClick={() => onOpen(scan)}>
                    {open ? t("scan.reviewing") : t("scan.review")}
                  </Button>
                )}
                {scan.status === "Failed" && !notReceipt && (
                  <Button type="button" variant="secondary" disabled={open} onClick={() => onOpen(scan)}>
                    {t("scan.enter_by_hand")}
                  </Button>
                )}
                {/* Cancel while it is still being read; Remove once it is done. Both drop it from the list. */}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { dismissScan(scan.scanID); if (open) onCancelOpen?.(scan); }}
                  aria-label={`${scan.status === "Scanning" ? t("scan.cancel") : t("common.remove")}: ${name}`}
                >
                  {scan.status === "Scanning" ? t("scan.cancel") : t("common.remove")}
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
