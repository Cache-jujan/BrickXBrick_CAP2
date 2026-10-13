// geminiReceipt.js — F6 receipt OCR through Gemini (the only OCR engine).
//
// Gemini reads the image or PDF and returns structured JSON in one call, so
// there is no rawText -> regex step. geminiJsonToParsed() maps that JSON onto
// the SAME shape parseReceiptText() returns (storeName / orSiNumber / date /
// amount / lineItems / confidence), so toExpenseDraft, classifyBir (F7) and
// the F8 allocation code see no difference between engines.
//
// CONFIDENTIALITY: until the project is confirmed off Gemini's free tier
// (which may train on what it is sent), only send FAKE receipts.
//
// Env:
//   GEMINI_API_KEY   required; without it every scan falls to manual entry
//   GEMINI_MODEL     optional, defaults to DEFAULT_MODEL

// Required at load time, not lazily: see the note in receiptOcr.js.
const { GoogleGenAI } = require("@google/genai");

const DEFAULT_MODEL = "gemini-3.8-flash";
// Tried when the main model is overloaded (503), rate-limited or slow.
// Flash-lite answers in about a second and is rarely overloaded.
const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash-lite";

// Bump when PROMPT or RESPONSE_SCHEMA changes: the OCR eval caches answers
// per model AND prompt version, so a new prompt is never scored on old answers.
const PROMPT_VERSION = 2;

// Per model attempt. A Gemini call that hangs would hold the Purchaser on
// the "Reading receipt…" screen; past this the next model is tried, then
// manual entry.
const TIMEOUT_MS = 25000;

const PROMPT = `You are reading a Philippine purchase receipt (official receipt, sales invoice, or an informal hardware/store receipt) for construction materials.
Return ONLY the fields in the JSON schema. Rules:
- Copy values exactly as printed. Never guess or invent a value; use null when a field is not printed or not legible.
- storeName: the seller's business name as printed at the top (not the buyer, not "SOLD TO").
- tin: the SELLER's TIN (e.g. "123-456-789-00000"), not the customer's TIN.
- birPermitType: "ATP" for an Authority to Print, "PTU" for a Permit to Use, "Permit" for any other BIR permit/accreditation number; null if none.
- birPermitNumber: the BIR ATP / PTU / permit / accreditation number.
- orSiNumber: the official receipt, sales invoice, or charge invoice number (often after "No." or printed in red).
- date: the transaction date as YYYY-MM-DD, taken from the "Date:" field of the receipt (often handwritten). Philippine receipts write it as MM/DD/YY, M-D-YY or MM/DD/YYYY; a two-digit year 25 means 2025. Never use dates from the printer/ATP block at the bottom ("Issued", "Date Issued", "Printer's Accreditation", booklet ranges) or a year printed beside the receipt number. A receipt is never dated before its ATP was issued.
- amount: the final amount paid (TOTAL / AMOUNT DUE / TOTAL SALES incl. VAT), as a number without commas or currency signs.
- lineItems: EVERY purchased item row in the items table, including handwritten rows. For each row give description, quantity, unitPrice, and amount (the row total from the AMOUNT column). Use null only for a column that is blank or illegible on that row. Do not include subtotal, VAT, discount, change or cash rows.
- uncertainFields: names of any fields above you were not confident about (blurry, cut off, handwritten, or ambiguous).`;

// Gemini structured-output schema (OpenAPI subset). Plain strings are used
// for types so this file doesn't depend on the SDK's Type enum.
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    storeName: { type: "STRING", nullable: true },
    tin: { type: "STRING", nullable: true },
    birPermitType: { type: "STRING", nullable: true, enum: ["ATP", "PTU", "Permit"] },
    birPermitNumber: { type: "STRING", nullable: true },
    orSiNumber: { type: "STRING", nullable: true },
    date: { type: "STRING", nullable: true, description: "YYYY-MM-DD" },
    amount: { type: "NUMBER", nullable: true },
    lineItems: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING" },
          quantity: { type: "NUMBER", nullable: true },
          unitPrice: { type: "NUMBER", nullable: true },
          amount: { type: "NUMBER", nullable: true },
        },
        // All four required: with only description required, the model
        // tended to skip the amount column entirely (prompt v1 eval).
        required: ["description", "quantity", "unitPrice", "amount"],
        propertyOrdering: ["description", "quantity", "unitPrice", "amount"],
      },
    },
    uncertainFields: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["storeName", "tin", "birPermitNumber", "orSiNumber", "date", "amount", "lineItems"],
  propertyOrdering: [
    "storeName", "tin", "birPermitType", "birPermitNumber", "orSiNumber", "date", "amount", "lineItems", "uncertainFields",
  ],
};

/** Models to try in order: GEMINI_MODEL, then GEMINI_FALLBACK_MODEL. */
function geminiModels() {
  const primary = (process.env.GEMINI_MODEL || "").trim() || DEFAULT_MODEL;
  const fallback = (process.env.GEMINI_FALLBACK_MODEL || "").trim() || DEFAULT_FALLBACK_MODEL;
  return fallback === primary || fallback.toLowerCase() === "none" ? [primary] : [primary, fallback];
}

function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

let client = null;
function getGeminiClient() {
  if (client) return client;
  if (!isGeminiConfigured()) throw new Error("GEMINI_API_KEY is not set");
  client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gemini OCR timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Send one receipt (image or PDF bytes) to Gemini and return its raw JSON
 * object. `gemini` is injectable for tests.
 */
async function extractReceiptJson(buffer, mimeType, { gemini, model } = {}) {
  const ai = gemini || getGeminiClient();
  const response = await withTimeout(
    ai.models.generateContent({
      model: model || process.env.GEMINI_MODEL || DEFAULT_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: Buffer.from(buffer).toString("base64") } },
            { text: PROMPT },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0,
        // Reading a receipt needs little reasoning. Full thinking took the
        // flash models past TIMEOUT_MS; "low" is ~3x faster.
        thinkingConfig: { thinkingLevel: "low" },
      },
    }),
    TIMEOUT_MS
  );

  const text = typeof response.text === "function" ? response.text() : response.text;
  if (!text) throw new Error("Gemini returned an empty response");
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error("Gemini returned invalid JSON: " + err.message);
  }
}

// ---------------------------------------------------------------------
// Pure mapper — unit-tested without calling Google.
// ---------------------------------------------------------------------

const PERMIT_TYPES = { ATP: "ATP", PTU: "PTU", PERMIT: "Permit" };

function cleanString(value) {
  if (value === undefined || value === null) return null;
  const out = String(value).trim();
  return out.length > 0 && !/^(null|n\/a|none)$/i.test(out) ? out : null;
}

// Accepts 1234.5, "1,234.50", "₱1,234.50"; anything else -> null.
// Rounded to 2 decimals: model output carries float noise (185.00000000000003).
function cleanNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[₱,\s]|PHP/gi, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Only a real calendar date in YYYY-MM-DD survives; the review screen's
// date picker handles the rest.
function cleanDate(value) {
  const text = cleanString(value);
  const m = text && /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
  return real && y >= 2000 ? text : null;
}

function cleanLineItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const description = cleanString(item && item.description);
      const quantity = cleanNumber(item && item.quantity);
      const unitPrice = cleanNumber(item && item.unitPrice);
      let amount = cleanNumber(item && item.amount);
      // Row total missing but qty x unit price printed: derive it.
      if (amount === null && quantity !== null && unitPrice !== null) {
        amount = Math.round(quantity * unitPrice * 100) / 100;
      }
      return { description, quantity, unitPrice, amount, confidence: "medium" };
    })
    .filter((item) => item.description && item.amount !== null);
}

// Gemini's field names -> the keys parseReceiptText uses in `confidence`.
const CONFIDENCE_FIELDS = {
  storeName: "vendorName",
  date: "date",
  amount: "amount",
  tin: "tin",
  birPermitNumber: "birPermitNumber",
  orSiNumber: "orSiNumber",
};

/**
 * Gemini JSON -> parseReceiptText()-shaped object.
 * Confidence: "low" when missing or self-reported uncertain, otherwise
 * "medium". Never "high": a model reading is not a labeled match.
 */
function geminiJsonToParsed(json) {
  const raw = json && typeof json === "object" ? json : {};
  const amount = cleanNumber(raw.amount);
  const permitType = cleanString(raw.birPermitType);

  const parsed = {
    storeName: cleanString(raw.storeName),
    tin: cleanString(raw.tin),
    birPermitNumber: cleanString(raw.birPermitNumber),
    birPermitType: permitType ? PERMIT_TYPES[permitType.toUpperCase()] || null : null,
    orSiNumber: cleanString(raw.orSiNumber),
    amount: amount !== null ? String(amount) : null,
    date: cleanDate(raw.date),
    lineItems: cleanLineItems(raw.lineItems),
  };

  const uncertain = new Set(Array.isArray(raw.uncertainFields) ? raw.uncertainFields.map(String) : []);
  parsed.confidence = {};
  for (const [field, key] of Object.entries(CONFIDENCE_FIELDS)) {
    const present = parsed[field] !== null;
    parsed.confidence[key] = present && !uncertain.has(field) ? "medium" : "low";
  }
  return parsed;
}

/** Image/PDF bytes -> parseReceiptText()-shaped object. */
async function parseReceiptWithGemini(buffer, mimeType, options) {
  const json = await extractReceiptJson(buffer, mimeType, options);
  return geminiJsonToParsed(json);
}

module.exports = {
  DEFAULT_MODEL,
  DEFAULT_FALLBACK_MODEL,
  geminiModels,
  PROMPT_VERSION,
  isGeminiConfigured,
  extractReceiptJson,
  geminiJsonToParsed,
  parseReceiptWithGemini,
};
