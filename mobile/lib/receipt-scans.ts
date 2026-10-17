// Background receipt scanning (backend routes/receipts.js, POST /scans).
// The upload returns a scanID straight away; OCR keeps running on the server
// even if the user leaves the screen or closes the app.
import * as FileSystem from "expo-file-system/legacy";

import { API_URL, authHeaders } from "@/constants/api";
import type { FileState } from "@/components/file-preview";
import type { DraftMode } from "@/lib/expense-draft-context";
import type { OcrResult, SelectedTicket } from "@/lib/expense-types";

// What the app needs to pick the receipt up again later.
export type ScanContext = {
  mode: DraftMode;
  ticket: SelectedTicket | null;
  fileName: string;
  fileType: "image" | "pdf";
};

export type ScanStatus = "Scanning" | "Ready" | "Failed";

export type ReceiptScan = {
  scanID: string;
  status: ScanStatus;
  receiptImageURL: string;
  mimeType: string;
  context: ScanContext | null;
  result: OcrResult | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

async function readJson(res: Response, what: string) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to ${what} (${res.status})`);
  return data;
}

export async function startScan(file: NonNullable<FileState>, context: ScanContext): Promise<ReceiptScan> {
  const upload = await FileSystem.uploadAsync(`${API_URL}/api/receipts/scans`, file.uri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "file",
    mimeType: file.mimeType ?? (file.type === "image" ? "image/jpeg" : "application/pdf"),
    parameters: { context: JSON.stringify(context) },
    headers: authHeaders(),
  });
  if (upload.status < 200 || upload.status >= 300) throw new Error(`Server responded ${upload.status}`);
  return JSON.parse(upload.body);
}

export async function fetchScan(scanID: string): Promise<ReceiptScan> {
  const res = await fetch(`${API_URL}/api/receipts/scans/${scanID}`, { headers: authHeaders() });
  return readJson(res, "load the scan");
}

export async function fetchScans(): Promise<ReceiptScan[]> {
  const res = await fetch(`${API_URL}/api/receipts/scans`, { headers: authHeaders() });
  return readJson(res, "load scanned receipts");
}

// Hides the scan from "Scanned receipts". Best effort: a failure only means
// the row lingers in the list, so callers don't need to wait on it.
export async function dismissScan(scanID: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/receipts/scans/${scanID}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok && res.status !== 404) throw new Error(`Failed to remove the scan (${res.status})`);
}

// The server builds image URLs from its own PUBLIC_BASE_URL, which may be
// "localhost" in development. Re-point the path at the API the phone uses.
export function phoneReachableUrl(url: string): string {
  const marker = "/receipts/files/";
  const at = url.indexOf(marker);
  return at >= 0 ? `${API_URL}${url.slice(at)}` : url;
}

// The FileState the review screen shows for a scan picked up later.
export function fileFromScan(scan: ReceiptScan): NonNullable<FileState> {
  const uri = phoneReachableUrl(scan.receiptImageURL);
  const name = scan.context?.fileName ?? "Receipt";
  return scan.mimeType === "application/pdf"
    ? { type: "pdf", name, size: "", uri, mimeType: scan.mimeType }
    : { type: "image", name, uri, mimeType: scan.mimeType };
}

// Draft for a scan the server couldn't read: empty fields, real image.
export function manualEntryResult(scan: ReceiptScan): OcrResult {
  return {
    vendorName: null, tin: null, birNumber: null, birPermitType: null, birPermitNumber: null,
    amount: null, receiptDate: null, lineItems: [],
    receiptImageURL: scan.receiptImageURL,
    ocrError: scan.errorMessage,
  };
}

// "Just now", "5 min ago", "2:14 PM", "Oct 12"
export function scanTimeLabel(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.round((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const sameDay = then.toDateString() === new Date().toDateString();
  return sameDay
    ? then.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })
    : then.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}
