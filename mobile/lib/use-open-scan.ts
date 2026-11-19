// Opens a background scan from wherever the user finds it (the scanning
// screen or "Scanned receipts" on Home), restoring the draft it belongs to.
import { Alert } from "react-native";
import { router } from "expo-router";

import { useExpenseDraft } from "@/lib/expense-draft-context";
import { useLocale } from "@/lib/i18n-context";
import { fileFromScan, isNotReceipt, manualEntryResult, scanTimeLabel, type ReceiptScan } from "@/lib/receipt-scans";
import { snappedFor } from "@/lib/turn-in";

// From the scanning screen, navigation REPLACES it: going back from review
// must not land on a finished scan that would open review again.
type Nav = { replace?: boolean };
const go = (href: Parameters<typeof router.push>[0], nav: Nav) => (nav.replace ? router.replace(href) : router.push(href));

export function useOpenScan() {
  const { draft, resumeScan, reset, setTicket, startSplit } = useExpenseDraft();
  const { t, intlLocale } = useLocale();

  function restore(scan: ReceiptScan, ocrResult: ReceiptScan["result"]) {
    // Same session as the capture: keep the local file (sharper, no download).
    const file = draft.scanID === scan.scanID && draft.file ? draft.file : fileFromScan(scan);
    resumeScan({
      scanID: scan.scanID,
      mode: scan.context?.mode ?? "single",
      ticket: scan.context?.ticket ?? null,
      file,
      ocrResult,
      scope: scan.context?.projectIds?.length
        ? { projectIds: scan.context.projectIds, projectNames: scan.context.projectNames ?? [] }
        : null,
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

  // Start a fresh capture for the same request (or the same projects, for a "snap now"
  // receipt), so the Purchaser can send the right photo.
  function retake(scan: ReceiptScan) {
    const ticket = scan.context?.ticket ?? null;
    if (scan.context?.mode !== "split" && ticket) {
      reset();
      setTicket(ticket);
    } else {
      const ids = scan.context?.projectIds;
      startSplit(ids?.length ? { projectIds: ids, projectNames: scan.context?.projectNames ?? [] } : null);
    }
    router.push("/expense/capture");
  }

  // Not a receipt: say why, what it was snapped for, and offer a new photo. Never manual entry.
  // onRemove takes the rejected file off the list; taking a new photo removes it too.
  function explainNotReceipt(scan: ReceiptScan, onRemove?: () => void) {
    const { request, project } = snappedFor(scan.context);
    const body = [
      scan.errorMessage ?? t("ti.not_receipt_body"),
      "",
      `${t("ti.detail_request")}: ${request ?? t("ti.detail_no_request")}`,
      `${t("ti.detail_project")}: ${project ?? t("ti.detail_no_project")}`,
      scan.context?.fileName ? `${t("ti.detail_file")}: ${scan.context.fileName}` : null,
      `${t("ti.detail_taken")}: ${scanTimeLabel(scan.createdAt, t, intlLocale)}`,
    ].filter((line) => line !== null).join("\n");
    Alert.alert(t("scan.status_not_receipt"), body, [
      { text: t("common.cancel"), style: "cancel" },
      ...(onRemove ? [{ text: t("common.remove"), style: "destructive" as const, onPress: onRemove }] : []),
      { text: t("ti.retake"), onPress: () => { onRemove?.(); retake(scan); } },
    ]);
  }

  // Failed, or the user would rather not wait: type it in against the photo.
  function openManual(scan: ReceiptScan, nav: Nav = {}, onRemove?: () => void) {
    if (isNotReceipt(scan)) return explainNotReceipt(scan, onRemove);
    if (missingTicket(scan)) return;
    restore(scan, manualEntryResult(scan));
    go("/expense/review", nav);
  }

  function openScanning(scan: ReceiptScan) {
    router.push({ pathname: "/expense/scanning", params: { id: scan.scanID } });
  }

  return { openReady, openManual, openScanning, retake };
}
