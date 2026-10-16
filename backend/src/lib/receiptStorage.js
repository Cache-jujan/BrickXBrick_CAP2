// receiptStorage.js — where receiptImageURL actually comes from.
//
// `expenses.receiptimageurl` is NOT NULL, so something has to produce a
// real, retrievable URL at submit time. Rather than accept a placeholder
// string from the client (which would let anyone submit an expense with a
// receipt that doesn't exist), the image is stored server-side during
// /receipts/scan and the route returns the URL it produced.
//
// Local disk for now; moving to Cloudflare R2 later is a change to this file
// only, because every caller sees the same storeReceiptImage(buffer, mimeType)
// -> url contract. The stored URL is always
// <PUBLIC_BASE_URL>/receipts/files/<name>; that path is not public: it is
// served by routes/receiptFiles.js only with a short-lived signed link.

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const STORAGE_DIR = path.resolve(
  process.env.RECEIPT_STORAGE_DIR || path.join(__dirname, "../../storage/receipts")
);

// Used to build an absolute URL. In dev: http://localhost:3000
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, "");

const EXTENSION_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "application/pdf": ".pdf",
};
const MIME_BY_EXTENSION = { ".jpg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf" };

const MAGIC = {
  ".jpg": [0xff, 0xd8, 0xff],
  ".png": [0x89, 0x50, 0x4e, 0x47],
  ".pdf": [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
};

const FILENAME_SHAPE = /^[0-9a-f-]{36}\.(jpg|png|pdf)$/i;

function isAllowedMime(mimeType) {
  return Object.prototype.hasOwnProperty.call(EXTENSION_BY_MIME, mimeType);
}

// The declared MIME type is client-controlled; check the real bytes too.
function hasValidReceiptBytes(buffer, mimeType) {
  const signature = MAGIC[EXTENSION_BY_MIME[mimeType]];
  if (!signature || !buffer || buffer.length < signature.length) return false;
  return signature.every((byte, i) => buffer[i] === byte);
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
  if (!hasValidReceiptBytes(buffer, mimeType)) {
    const err = new Error("The file contents don't match its type. Upload a real JPEG, PNG or PDF.");
    err.status = 400;
    throw err;
  }

  const extension = EXTENSION_BY_MIME[mimeType];
  const filename = `${crypto.randomUUID()}${extension}`;
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  await fs.writeFile(path.join(STORAGE_DIR, filename), buffer);

  return `${PUBLIC_BASE_URL}/receipts/files/${filename}`;
}

// The stored file name for a URL this server issued, or null.
function receiptFilename(url) {
  if (typeof url !== "string") return null;
  if (!url.startsWith(`${PUBLIC_BASE_URL}/receipts/files/`)) return null;
  const filename = path.basename(url);
  return FILENAME_SHAPE.test(filename) ? filename : null;
}

// Clients may hold the URL under a different host (the phone re-points it at the
// API address it uses). Rebuild the canonical URL from the file name alone.
function canonicalReceiptUrl(url) {
  if (typeof url !== "string") return null;
  const m = /\/receipts\/files\/([^/?#]+)(?:[?#].*)?$/.exec(url);
  if (!m || !FILENAME_SHAPE.test(m[1])) return null;
  return `${PUBLIC_BASE_URL}/receipts/files/${m[1]}`;
}

/**
 * Cheap integrity gate for POST /expenses: confirms the submitted URL is
 * one this server actually issued, so the NOT NULL column can't be
 * satisfied with an arbitrary string.
 */
async function receiptImageExists(url) {
  const filename = receiptFilename(url);
  if (!filename) return false;

  try {
    await fs.access(path.join(STORAGE_DIR, filename));
    return true;
  } catch {
    return false;
  }
}

// openReceipt(filename) -> { body (Buffer), contentType } or null.
async function openReceipt(filename) {
  if (!FILENAME_SHAPE.test(filename)) return null;
  const contentType = MIME_BY_EXTENSION[path.extname(filename).toLowerCase()];
  try {
    return { body: await fs.readFile(path.join(STORAGE_DIR, filename)), contentType };
  } catch {
    return null;
  }
}

// --- Signed, expiring links -------------------------------------------------
// <img>, <iframe> and <a href> can't send an Authorization header, so access
// is a link signed with HMAC and valid for a few minutes. The signed link is
// only handed out by GET /api/receipts/link, which checks who is asking.
const LINK_TTL_SECONDS = 300;
// Per-process fallback when RECEIPT_LINK_SECRET is unset: links die on restart
// and don't verify across instances. Fine for dev; set it in production.
const linkSecret = process.env.RECEIPT_LINK_SECRET || crypto.randomBytes(32).toString("hex");

const sign = (filename, exp) =>
  crypto.createHmac("sha256", linkSecret).update(`${filename}.${exp}`).digest("hex");

function signReceiptUrl(url, now = Date.now()) {
  const filename = receiptFilename(url);
  if (!filename) return null;
  const exp = Math.floor(now / 1000) + LINK_TTL_SECONDS;
  return `${url}?exp=${exp}&sig=${sign(filename, exp)}`;
}

function verifyReceiptSignature(filename, exp, sig, now = Date.now()) {
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || expNum < Math.floor(now / 1000)) return false;
  if (typeof sig !== "string" || !/^[0-9a-f]{64}$/i.test(sig)) return false;
  return crypto.timingSafeEqual(Buffer.from(sign(filename, expNum), "hex"), Buffer.from(sig, "hex"));
}

module.exports = {
  storeReceiptImage, receiptImageExists, receiptFilename, canonicalReceiptUrl, openReceipt,
  signReceiptUrl, verifyReceiptSignature, hasValidReceiptBytes,
  STORAGE_DIR, isAllowedMime,
};
