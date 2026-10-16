// receiptStorage.js — where receiptImageURL actually comes from.
//
// `expenses.receiptimageurl` is NOT NULL, so something has to produce a
// real, retrievable URL at submit time. Rather than accept a placeholder
// string from the client (which would let anyone submit an expense with a
// receipt that doesn't exist), the image is stored server-side during
// /receipts/scan and the route returns the URL it produced.
//
// Receipts live in Cloudflare R2 under the `receipts/` prefix of the bucket
// (R2_BUCKET). Every caller still sees the same
// storeReceiptImage(buffer, mimeType) -> url contract as before.

const crypto = require("crypto");
const r2 = require("./r2");

const KEY_PREFIX = "receipts";

const EXTENSION_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
};

// What we store in the bucket. image/jpg is not a real MIME type, so it is
// saved as image/jpeg.
const CONTENT_TYPE_BY_MIME = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "application/pdf": "application/pdf",
};

// receipts/<uuid>.<jpg|png|pdf> — the only key shape this module ever writes.
const RECEIPT_KEY_RE = /^receipts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|pdf)$/i;

function isAllowedMime(mimeType) {
  return Object.prototype.hasOwnProperty.call(EXTENSION_BY_MIME, mimeType);
}

/**
 * Persist a receipt image and return the URL to store in
 * expenses.receiptimageurl.
 *
 * The object name is a random UUID, never the client-supplied name — an
 * uploaded filename is attacker-controlled.
 */
async function storeReceiptImage(buffer, mimeType) {
  if (!isAllowedMime(mimeType)) {
    const err = new Error(`Unsupported receipt file type: ${mimeType}`);
    err.status = 400;
    throw err;
  }

  const key = `${KEY_PREFIX}/${crypto.randomUUID()}${EXTENSION_BY_MIME[mimeType]}`;
  return r2.putObject(key, buffer, CONTENT_TYPE_BY_MIME[mimeType]);
}

/**
 * Cheap integrity gate for POST /expenses: confirms the submitted URL is
 * one this server actually issued, so the NOT NULL column can't be
 * satisfied with an arbitrary string.
 *
 * Returns true/false for "the receipt is / is not there". If R2 itself can't
 * be reached (timeout, network, credentials) this THROWS instead of returning
 * false, so callers never mistake "could not check" for "missing".
 */
async function receiptImageExists(url) {
  const key = r2.keyFromPublicUrl(url);
  if (!key || !RECEIPT_KEY_RE.test(key)) return false;
  return r2.objectExists(key);
}

module.exports = { storeReceiptImage, receiptImageExists, isAllowedMime, KEY_PREFIX };