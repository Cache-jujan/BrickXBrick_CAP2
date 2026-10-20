// receipts.js — F6 receipt capture + OCR extraction.
//
// Returns a draft in the exact shape POST /expenses expects, so the review
// screen can correct the low-confidence fields and post it straight back.
//
//   POST   /scan        upload and wait for the draft (original flow)
//   POST   /scans       upload, get a scanID at once; OCR runs in the background
//   GET    /scans       the caller's recent scans (Scanning / Ready / Failed)
//   GET    /scans/:id   one scan, with its draft once Ready
//   DELETE /scans/:id   hide a scan (submitted, or discarded by the user)

const express = require("express");
const multer = require("multer");

const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { query } = require("../lib/db");
const rateLimit = require("express-rate-limit");
const { storeReceiptImage, isAllowedMime, MAX_RECEIPT_BYTES } = require("../lib/receiptStorage");
const { preparePdfForOcr } = require("../lib/pdfReceipt");
const { buildScanDraft } = require("../lib/scanDraft");
const { createReceiptScans, parseContext } = require("../lib/receiptScans");

const router = express.Router();
const scans = createReceiptScans({ query, buildScanDraft });

// Purchaser is primary; Site Managers may capture only for their own resolved
// Material Requests, while GM/PM may use the documented backup flow.
const SCAN_ROLES = ["Purchaser", "Site Manager", "General Manager", "Project Manager"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every route here touches OCR quota and writes files to disk — none of it
// should be reachable unauthenticated.
router.use(requireAuth);

// Each scan costs a Gemini call and stores a file, so cap them per user.
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  /** Share the scan quota across requests made by the same authenticated user. */
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many receipt scans. Wait a minute and try again." },
});

// memoryStorage keeps the upload in RAM as req.file.buffer. The buffer goes
// to two places: Gemini (for OCR) and storeReceiptImage (for the URL that
// satisfies expenses.receiptimageurl NOT NULL).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_RECEIPT_BYTES },
  fileFilter: (req, file, cb) => {
    if (!isAllowedMime(file.mimetype)) {
      const err = new Error(`Unsupported file type: ${file.mimetype}. Use JPEG, PNG, WebP, or PDF.`);
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

// multer reports an oversize file as a MulterError with no HTTP status, which
// would surface as a 500. Turn it into a clear 413.
function receiptUpload(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      const tooBig = new Error(`That file is larger than ${MAX_RECEIPT_BYTES / (1024 * 1024)} MB. Choose a smaller one.`);
      tooBig.status = 413;
      return next(tooBig);
    }
    next(err);
  });
}

// What OCR reads. An image goes as it is. A PDF is checked first (encrypted,
// unreadable or empty -> 400) and cut to its first pages. The stored file is
// always the original upload.
async function bytesForOcr(file) {
  if (file.mimetype !== "application/pdf") return file.buffer;
  return (await preparePdfForOcr(file.buffer)).buffer;
}

function requireFile(req) {
  if (!req.file) {
    const err = new Error("No file uploaded — send one file under the form field name 'file'");
    err.status = 400;
    throw err;
  }
}

function notFound() {
  const err = new Error("Scan not found");
  err.status = 404;
  return err;
}

/** Upload a receipt and return its OCR draft, recording the scan when possible. */
router.post("/scan", requireRole(...SCAN_ROLES), scanLimiter, receiptUpload, async (req, res, next) => {
  try {
    requireFile(req);
    const ocrBytes = await bytesForOcr(req.file);
    // Store first: if OCR fails, the image is still on disk and the user can
    // fall back to manual entry against a real receiptImageURL rather than
    // re-uploading.
    const receiptImageURL = await storeReceiptImage(req.file.buffer, req.file.mimetype);
    const draft = await buildScanDraft(ocrBytes, req.file.mimetype, receiptImageURL);
    // Saved so F9 can tell what the submitter changed. Without it
    // the expense is flagged Manual_Entry, so a failure here is logged, not fatal.
    try {
      await scans.recordScan({ userID: req.user.id, receiptImageURL, mimeType: req.file.mimetype, draft });
    } catch (err) {
      console.error("Could not save the scan result for the scan comparison:", err.message);
    }
    res.json(draft);
  } catch (err) {
    next(err);
  }
});

/**
 * Upload a receipt and return a scan ID before starting OCR in the background.
 * Accept optional multipart JSON context; GET /scans/:id retrieves the draft later.
 */
router.post("/scans", requireRole(...SCAN_ROLES), scanLimiter, receiptUpload, async (req, res, next) => {
  try {
    requireFile(req);
    const { buffer, mimetype } = req.file;
    const ocrBytes = await bytesForOcr(req.file);
    const receiptImageURL = await storeReceiptImage(buffer, mimetype);
    const scan = await scans.createScan({
      userID: req.user.id,
      receiptImageURL,
      mimeType: mimetype,
      context: parseContext(req.body && req.body.context),
    });

    res.status(202).json(scan);

    // After the response on purpose: the user doesn't wait for OCR.
    // runScan never throws.
    scans.runScan(scan.scanID, ocrBytes, mimetype, receiptImageURL);
  } catch (err) {
    next(err);
  }
});

router.get("/scans", requireRole(...SCAN_ROLES), async (req, res, next) => {
  try {
    res.json(await scans.listScans(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.get("/scans/:id", requireRole(...SCAN_ROLES), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) throw notFound();
    const scan = await scans.getScan(req.params.id, req.user.id);
    if (!scan) throw notFound();
    res.json(scan);
  } catch (err) {
    next(err);
  }
});

router.delete("/scans/:id", requireRole(...SCAN_ROLES), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) throw notFound();
    if (!(await scans.dismissScan(req.params.id, req.user.id))) throw notFound();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
