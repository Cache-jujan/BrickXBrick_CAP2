// Rules for a receipt file picked on the phone. They mirror the backend
// (backend/src/lib/receiptStorage.js): the same types and the same size limit,
// so a bad file is refused here with a clear message instead of failing at upload.

// Keep equal to MAX_RECEIPT_BYTES on the backend.
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PDF_MIME_TYPE = "application/pdf";

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: PDF_MIME_TYPE,
};

export function formatBytes(bytes?: number | null) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The receipt's MIME type, from what the picker said or else the file name. */
export function receiptMimeType(mimeType?: string | null, fileName?: string | null): string | null {
  const given = mimeType?.toLowerCase();
  if (given === "image/jpg") return "image/jpeg";
  if (given && given !== "application/octet-stream") return given;
  const extension = fileName?.split(".").pop()?.toLowerCase();
  return (extension && MIME_BY_EXTENSION[extension]) || null;
}

export function isAllowedReceiptType(mimeType: string | null): mimeType is (typeof IMAGE_MIME_TYPES)[number] | typeof PDF_MIME_TYPE {
  return mimeType === PDF_MIME_TYPE || (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType ?? "");
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * A message for the user if the file can't be used, or null when it is fine.
 * Pass `t` (from useLocale) to get the message in the chosen language; without it, English.
 */
export function receiptFileProblem(mimeType: string | null, bytes?: number | null, t?: Translate): string | null {
  if (!isAllowedReceiptType(mimeType)) {
    return t
      ? t("mx.file_type_bad")
      : "That file type isn't supported. Choose a JPEG, PNG or WebP photo, or a PDF.";
  }
  if (bytes && bytes > MAX_RECEIPT_BYTES) {
    return t
      ? t("mx.file_too_big", { size: formatBytes(bytes), max: formatBytes(MAX_RECEIPT_BYTES) })
      : `That file is too big (${formatBytes(bytes)}). Receipts must be ${formatBytes(MAX_RECEIPT_BYTES)} or smaller.`;
  }
  return null;
}
