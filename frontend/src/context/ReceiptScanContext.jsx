import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { dismissReceiptScan, listReceiptScans, startReceiptScan } from "../api/expensesApi";
import { requestNotificationsRefresh } from "../utils/notificationSync";
import { useAuth } from "./AuthContext";
import { useLocale } from "../i18n/LocaleProvider";
import "./ReceiptScanContext.css";

// Receipt scans run on the server, so a scan keeps going while the user fills in
// another receipt, opens another page or even closes the tab. This provider keeps
// the list, checks on it while something is still being read, and shows a pop-up
// (in the user's language) the moment a scan finishes. The server also files a
// notification, so the bell shows it too.

const SCAN_ROLES = ["General Manager", "Project Manager"];
const POLL_MS = 4000;
const TOAST_MS = 10000;
// Where each kind of scan is reviewed.
export const SCAN_PAGES = { submit: "/expenses/new", split: "/expenses/split", petty: "/expenses/trip-cost" };

const ReceiptScanContext = createContext(null);

export function ReceiptScanProvider({ children }) {
  const { user } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const canScan = SCAN_ROLES.includes(user?.role);

  const [scans, setScans] = useState([]);
  const [toasts, setToasts] = useState([]);
  // Scans this tab has seen still being read: when one stops, the user is told.
  const watching = useRef(new Set());
  const timers = useRef(new Map());

  const dropToast = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((x) => x.id !== id));
  }, []);

  const showToast = useCallback((scan) => {
    const id = `${scan.scanID}-${scan.status}`;
    setToasts((list) => (list.some((x) => x.id === id) ? list : [...list, { id, scan }]));
    timers.current.set(id, setTimeout(() => dropToast(id), TOAST_MS));
  }, [dropToast]);

  // Merge the server's list in, and announce every scan that just finished.
  const apply = useCallback((rows) => {
    let finished = false;
    for (const row of rows) {
      if (row.status === "Scanning") watching.current.add(row.scanID);
      else if (watching.current.delete(row.scanID)) {
        finished = true;
        showToast(row);
      }
    }
    setScans(rows);
    // The server files the bell notification just after the scan turns Ready, so wait a moment.
    if (finished) setTimeout(requestNotificationsRefresh, 1500);
  }, [showToast]);

  const refresh = useCallback(async () => {
    try {
      apply(await listReceiptScans());
    } catch {
      // Offline or busy: the next check tries again.
    }
  }, [apply]);

  // On sign-in, find scans that were started earlier (another tab, or before a reload).
  useEffect(() => {
    if (!canScan) { setScans([]); return; }
    refresh();
  }, [canScan, refresh]);

  // While anything is being read, check every few seconds.
  const anyScanning = scans.some((s) => s.status === "Scanning");
  useEffect(() => {
    if (!canScan || !anyScanning) return undefined;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [canScan, anyScanning, refresh]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /** Upload a receipt and return at once; reading continues on the server. */
  const startScan = useCallback(async (file, mode) => {
    const scan = await startReceiptScan(file, { source: "web", mode, fileName: file.name });
    watching.current.add(scan.scanID);
    setScans((list) => [scan, ...list.filter((s) => s.scanID !== scan.scanID)]);
    return scan;
  }, []);

  /** Hide a scan (after its expense is submitted, or when the user discards it). */
  const dismissScan = useCallback(async (scanID) => {
    watching.current.delete(scanID);
    setScans((list) => list.filter((s) => s.scanID !== scanID));
    try {
      await dismissReceiptScan(scanID);
    } catch {
      // The row only lingers in the list; the next refresh shows it again.
    }
  }, []);

  const value = useMemo(() => ({ scans, startScan, dismissScan, refresh }), [scans, startScan, dismissScan, refresh]);

  return (
    <ReceiptScanContext.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <div className="scan-toasts" role="status" aria-live="polite">
          {toasts.map(({ id, scan }) => {
            const ready = scan.status === "Ready";
            const name = scan.context?.fileName || t("scan.this_receipt");
            const page = SCAN_PAGES[scan.context?.mode] || SCAN_PAGES.submit;
            return (
              <div key={id} className={`scan-toast ${ready ? "scan-toast-ready" : "scan-toast-failed"}`}>
                <div className="scan-toast-text">
                  <strong>{ready ? t("scan.toast_ready_title") : t("scan.toast_failed_title")}</strong>
                  <span>{ready ? t("scan.toast_ready_body", { name }) : t("scan.toast_failed_body", { name })}</span>
                </div>
                <button
                  type="button"
                  className="scan-toast-action"
                  onClick={() => { dropToast(id); navigate(`${page}?scan=${scan.scanID}`); }}
                >
                  {ready ? t("scan.review") : t("scan.enter_by_hand")}
                </button>
                <button type="button" className="scan-toast-close" aria-label={t("pd.close")} onClick={() => dropToast(id)}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </ReceiptScanContext.Provider>
  );
}

export function useReceiptScans() {
  const ctx = useContext(ReceiptScanContext);
  if (!ctx) throw new Error("useReceiptScans must be used within ReceiptScanProvider");
  return ctx;
}

/**
 * For a page that reviews scans of one kind: when the address has ?scan=<id> (from the "receipt
 * ready" pop-up or the bell), open that scan once it has been read. A scan that belongs to
 * another kind of page is sent there instead.
 */
export function useOpenWantedScan(mode, openScan) {
  const { scans } = useReceiptScans();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const wanted = params.get("scan");

  useEffect(() => {
    if (!wanted) return;
    const scan = scans.find((x) => x.scanID === wanted);
    if (!scan || scan.status === "Scanning") return; // still reading, or the list has not loaded yet
    const home = scan.context?.source === "web" && SCAN_PAGES[scan.context.mode] ? scan.context.mode : "submit";
    if (home !== mode) {
      navigate(`${SCAN_PAGES[home]}?scan=${wanted}`, { replace: true });
      return;
    }
    openScan(scan);
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when the list or the wanted id changes
  }, [wanted, scans]);
}
