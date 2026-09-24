// receipts.js — F6 receipt capture + OCR extraction.
//
// Returns a draft in the exact shape POST /expenses expects, so the review
// screen can correct the low-confidence fields and post it straight back.

const express = require("express");
const multer = require("multer");

const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { extractTextFromImage } = require("../lib/visionClient");
const { storeReceiptImage, isAllowedMime } = require("../lib/receiptStorage");
const { parseReceiptText } = require("../lib/parser");
const { toExpenseDraft, classifyBir } = require("../lib/receiptFields");

const router = express.Router();

// Every route here touches OCR quota and writes files to disk — none of it
// should be reachable unauthenticated.
router.use(requireAuth);

// memoryStorage keeps the upload in RAM as req.file.buffer. The buffer goes
// to two places: Vision (for OCR) and storeReceiptImage (for the URL that
// satisfies expenses.receiptimageurl NOT NULL).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    
    if (!isAllowedMime(file.mimetype)) {
      const err = new Error(`Unsupported file type: ${file.mimetype}. Use JPEG, PNG, or PDF.`);
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

// POST /scan — upload a receipt, get back an expense draft.
// Purchaser is the primary actor for F6; add "General Manager",
// "Project Manager" here if you want the documented backup submitters.
router.post("/scan", requireRole("Purchaser", "General Manager", "Project Manager"), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      const err = new Error("No file uploaded — send one file under the form field name 'file'");
      err.status = 400;
      throw err;
    }

    // Store first: if OCR fails, the image is still on disk and the user can
    // fall back to manual entry against a real receiptImageURL rather than
    // re-uploading.
    const receiptImageURL = await storeReceiptImage(req.file.buffer, req.file.mimetype);

    let rawText = "";
    let ocrError = null;
    try {
      rawText = await extractTextFromImage(req.file.buffer);
    } catch (err) {
      // Vision being down shouldn't kill the submission path. Return an
      // empty draft plus the stored URL and let the user type the fields.
      console.error("Vision OCR failed:", err);
      ocrError = "OCR is unavailable — please enter the receipt details manually.";
    }

    const parsed = parseReceiptText(rawText);
    const draft = toExpenseDraft(parsed);
    const { birValidationStatus, missingBirFields } = classifyBir(draft);

    res.json({
      ...draft,
      receiptImageURL,
      birValidationStatus,
      missingBirFields,
      confidence: parsed.confidence,
      ocrError,
      rawText, // kept for debugging the parser against real receipts
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;