// Opens a background scan from wherever the user finds it (the scanning
// screen or "Scanned receipts" on Home), restoring the draft it belongs to.
import { Alert } from "react-native";
import { router } from "expo-router";

import { useExpenseDraft } from "@/lib/expense-draft-context";
import { fileFromScan, manualEntryResult, type ReceiptScan } from "@/lib/receipt-scans";

// From the scanning screen, navigation REPLACES it: going back from review
// must not land on a finished scan that would open review again.
type Nav = { replace?: boolean };
const go = (href: Parameters<typeof router.push>[0], nav: Nav) => (nav.replace ? router.replace(href) : router.push(href));

export function useOpenScan() {
  const { draft, resumeScan } = useExpenseDraft();

  function restore(scan: ReceiptScan, ocrResult: ReceiptScan["result"]) {
    // Same session as the capture: keep the local file (sharper, no download).
    const file = draft.scanID === scan.scanID && draft.file ? draft.file : fileFromScan(scan);
    resumeScan({
      scanID: scan.scanID,
      mode: scan.context?.mode ?? "single",
      ticket: scan.context?.ticket ?? null,
      file,
      ocrResult,
    });
  }

  // A single-mode scan whose ticket wasn't saved can't be linked; send the
  // user to pick the request again rather than into a dead end.
  function missingTicket(scan: ReceiptScan) {
    if (scan.context?.mode === "split" || scan.context?.ticket) return false;
    Alert.alert("Pick the request again", "This receipt isn't linked to a request. Open the request and scan it from there.");
    return true;
  }

  // Ready -> review screen. ocrError (OCR was down) means the fields are empty.
  function openReady(scan: ReceiptScan, nav: Nav = {}) {
    if (!scan.result || missingTicket(scan)) return;
    restore(scan, scan.result);
    if (scan.result.ocrError) Alert.alert("Heads up", scan.result.ocrError);
    go("/expense/review", nav);
  }

  // Failed, or the user would rather not wait: type it in against the photo.
  function openManual(scan: ReceiptScan, nav: Nav = {}) {
    if (missingTicket(scan)) return;
    restore(scan, manualEntryResult(scan));
    go("/expense/review", nav);
  }

  function openScanning(scan: ReceiptScan) {
    router.push({ pathname: "/expense/scanning", params: { id: scan.scanID } });
  }

  return { openReady, openManual, openScanning };
}
