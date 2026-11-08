// What a receipt file may be on the web. Same rules as the backend
// (backend/src/lib/receiptStorage.js) and the phone (mobile/lib/receipt-file.ts):
// a JPEG, PNG or WebP photo, or a PDF, up to 10 MB. Checking here gives a clear
// message at once instead of a failed upload.

// Keep equal to MAX_RECEIPT_BYTES on the backend.
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

const RECEIPT_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"];
const RECEIPT_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "pdf"];

// For the image picker: only the photo types we accept are offered.
export const RECEIPT_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

/** True when the file is a type we accept, by its MIME type or else its extension. */
export function isReceiptType(file) {
  if (!file) return false;
  if (RECEIPT_MIME_TYPES.includes(file.type)) return true;
  const extension = file.name?.split(".").pop()?.toLowerCase();
  return RECEIPT_EXTENSIONS.includes(extension);
}

// "10 MB", "10.4 MB", "640 KB". `roundUp` is for a file over the limit, so it
// never reads as the limit itself ("too big (10 MB) ... must be 10 MB or smaller").
export function formatFileSize(bytes, { roundUp = false } = {}) {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const shown = (roundUp ? Math.ceil(mb * 10) : Math.round(mb * 10)) / 10;
  return `${Number.isInteger(shown) ? shown : shown.toFixed(1)} MB`;
}

/**
 * Why this file can't be used as a receipt, as text in the user's language,
 * or "" when it is fine. `t` is the translate function from useLocale.
 */
export function receiptFileProblem(file, t) {
  if (!isReceiptType(file)) return t("errors.receipt_type");
  if (file.size > MAX_RECEIPT_BYTES) {
    const max = formatFileSize(MAX_RECEIPT_BYTES);
    const size = formatFileSize(file.size);
    return t("errors.receipt_size", { size: size === max ? formatFileSize(file.size, { roundUp: true }) : size, max });
  }
  return "";
}
