// receiptStorage.js — where receiptImageURL actually comes from.
//
// `expenses.receiptimageurl` is NOT NULL, so something has to produce a
// real, retrievable URL at submit time. Rather than accept a placeholder
// string from the client (which would let anyone submit an expense with a
// receipt that doesn't exist), the image is stored server-side during
// /receipts/scan and the route returns the URL it produced.
//
// Local disk now, Cloudflare R2 later: swapping backends is a change to
// this file only, because every caller sees the same
// storeReceiptImage(buffer, mimeType) -> url contract.

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const STORAGE_DIR = path.resolve(
  process.env.RECEIPT_STORAGE_DIR || path.join(__dirname, "../../storage/receipts")
);

// Used to build an absolute URL. In dev: http://localhost:3000
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

const EXTENSION_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
};

function isAllowedMime(mimeType) {
  return Object.prototype.hasOwnProperty.call(EXTENSION_BY_MIME, mimeType);
}

/**
 * Persist a receipt image and return the URL to store in
 * expenses.receiptimageurl.
 *
 * Filename is a random UUID, never the client-supplied name — an uploaded
 * filename is attacker-controlled and would otherwise allow path traversal.
 */
async function storeReceiptImage(buffer, mimeType) {
  if (!isAllowedMime(mimeType)) {
    const err = new Error(`Unsupported receipt file type: ${mimeType}`);
    err.status = 400;
    throw err;
  }

  await fs.mkdir(STORAGE_DIR, { recursive: true });

  const filename = `${crypto.randomUUID()}${EXTENSION_BY_MIME[mimeType]}`;
  await fs.writeFile(path.join(STORAGE_DIR, filename), buffer);

  return `${PUBLIC_BASE_URL}/receipts/files/${filename}`;
}

/**
 * Cheap integrity gate for POST /expenses: confirms the submitted URL is
 * one this server actually issued, so the NOT NULL column can't be
 * satisfied with an arbitrary string.
 *
 * When this moves to R2, replace the fs.access call with a HEAD on the
 * object; the signature and the callers stay the same.
 */
async function receiptImageExists(url) {
  if (typeof url !== "string") return false;
  if (!url.startsWith(`${PUBLIC_BASE_URL}/receipts/files/`)) return false;

  const filename = path.basename(url);
  // basename() strips any traversal, but re-check the shape anyway.
  if (!/^[0-9a-f-]{36}\.(jpg|png|pdf)$/i.test(filename)) return false;

  try {
    await fs.access(path.join(STORAGE_DIR, filename));
    return true;
  } catch {
    return false;
  }
}

module.exports = { storeReceiptImage, receiptImageExists, STORAGE_DIR, isAllowedMime };