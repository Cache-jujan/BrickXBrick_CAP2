// receiptOcr.js — runs the OCR for POST /receipts/scan. Gemini is the only
// engine: the main model, then the fallback model, then an empty draft for
// manual entry. Gemini returns the parseReceiptText() shape, so the route
// (and F7 / F8 behind it) see the same fields as before.
//
// Never throws for an OCR failure: the caller always gets a draft, plus an
// ocrError message when the user has to type the fields in.

const { parseReceiptText } = require("./parser");
// Loaded up front, not on the first scan: under `node --watch` (npm run dev)
// a module first required mid-request restarts the server and kills any
// background scan in flight.
const geminiReceipt = require("./geminiReceipt");

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
      console.log(`Gemini OCR (${model}) answered in ${Date.now() - started} ms`);
      return { parsed, engine: "gemini", model, ocrError: null };
    } catch (err) {
      console.error(`Gemini OCR (${model}) failed after ${Date.now() - started} ms:`, err.message || err);
    }
  }

  // Every model failed (or GEMINI_API_KEY is missing). An empty draft lets
  // the user type the fields against the stored image.
  return { parsed: parseReceiptText(""), engine: null, model: null, ocrError: MANUAL_ENTRY_MESSAGE };
}

module.exports = { scanReceipt, MANUAL_ENTRY_MESSAGE };
