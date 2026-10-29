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
export function ReceiptScanTray({ mode, activeScanID, onOpen }) {
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
          return (
            <li key={scan.scanID} className={`scan-row scan-row-${scan.status.toLowerCase()}${open ? " scan-row-open" : ""}`}>
              <span className="scan-row-name" title={name}>{name}</span>
              <span className="scan-row-status" role="status">
                {scan.status === "Scanning" && <><span className="scan-spinner" aria-hidden="true" />{t("scan.status_scanning")}</>}
                {scan.status === "Ready" && t("scan.status_ready")}
                {scan.status === "Failed" && t("scan.status_failed")}
              </span>
              <span className="scan-row-actions">
                {scan.status === "Ready" && (
                  <Button type="button" variant={open ? "secondary" : "primary"} disabled={open} onClick={() => onOpen(scan)}>
                    {open ? t("scan.reviewing") : t("scan.review")}
                  </Button>
                )}
                {scan.status === "Failed" && (
                  <Button type="button" variant="secondary" disabled={open} onClick={() => onOpen(scan)}>
                    {t("scan.enter_by_hand")}
                  </Button>
                )}
                {scan.status !== "Scanning" && (
                  <Button type="button" variant="ghost" onClick={() => dismissScan(scan.scanID)} aria-label={`${t("common.remove")}: ${name}`}>
                    {t("common.remove")}
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
