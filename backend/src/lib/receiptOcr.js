// receiptOcr.js — runs the OCR for POST /receipts/scan. Gemini is the only
// engine: the main model, then the fallback model, then an empty draft for
// manual entry. Gemini returns the parseReceiptText() shape, so the route
// (and F7 / F8 behind it) see the same fields as before.
//
// Never throws for an OCR failure (it does throw NotAReceiptError for a file that is not a receipt): the caller always gets a draft, plus an
// ocrError message when the user has to type the fields in.

const { parseReceiptText } = require("./parser");
// Loaded up front, not on the first scan: under `node --watch` (npm run dev)
// a module first required mid-request restarts the server and kills any
// background scan in flight.
const geminiReceipt = require("./geminiReceipt");

// Shown when the file is not a receipt. Never offers manual entry: nothing but a receipt can be posted.
const NOT_A_RECEIPT_MESSAGE = "This doesn't look like a receipt. Upload or take a photo of the official receipt or sales invoice.";

class NotAReceiptError extends Error {
  constructor(reason) {
    super(NOT_A_RECEIPT_MESSAGE);
    this.name = "NotAReceiptError";
    this.status = 422;
    this.code = "NOT_A_RECEIPT";
    this.reason = reason || null;
  }
}

const MANUAL_ENTRY_MESSAGE = "OCR is unavailable — please enter the receipt details manually.";

/**
 * Read a receipt with Gemini, falling back to manual entry.
 * Returns { parsed, engine, model, ocrError }; engine is "gemini", or null
 * when the user must type it all. deps are injectable for tests.
 */
async function scanReceipt(buffer, mimeType, deps = {}) {
  const {
    parseReceiptWithGemini = (...args) => geminiReceipt.parseReceiptWithGemini(...args),
    geminiModels = geminiReceipt.geminiModels,
  } = deps;

  // Main model, then the fallback model: an overloaded (503) or slow
  // model is common, and another model usually answers.
  for (const model of geminiModels()) {
    const started = Date.now();
    try {
      const parsed = await parseReceiptWithGemini(buffer, mimeType, { model });
      // A definite "not a receipt" is final: no fallback model, no manual entry.
      if (parsed && parsed.isReceipt === false) {
        console.log(`Gemini (${model}) says this file is not a receipt: ${parsed.notReceiptReason || "no reason"}`);
        throw new NotAReceiptError(parsed.notReceiptReason);
      }
      console.log(`Gemini OCR (${model}) answered in ${Date.now() - started} ms`);
      return { parsed, engine: "gemini", model, ocrError: null };
    } catch (err) {
      if (err instanceof NotAReceiptError) throw err;
      console.error(`Gemini OCR (${model}) failed after ${Date.now() - started} ms:`, err.message || err);
    }
  }

  // Every model failed (or GEMINI_API_KEY is missing). An empty draft lets
  // the user type the fields against the stored image.
  return { parsed: parseReceiptText(""), engine: null, model: null, ocrError: MANUAL_ENTRY_MESSAGE };
}

module.exports = { scanReceipt, MANUAL_ENTRY_MESSAGE, NotAReceiptError, NOT_A_RECEIPT_MESSAGE };
