const test = require("node:test");
const assert = require("node:assert/strict");

const { scanReceipt, MANUAL_ENTRY_MESSAGE } = require("../src/lib/receiptOcr");

const geminiParsed = { storeName: "From Gemini", lineItems: [], confidence: {} };
const failing = async () => { throw new Error("boom"); };

test("Gemini answers with the main model", async () => {
  const out = await scanReceipt(Buffer.from("x"), "image/jpeg", {
    geminiModels: () => ["main-model", "lite-model"],
    parseReceiptWithGemini: async () => geminiParsed,
  });
  assert.equal(out.engine, "gemini");
  assert.equal(out.model, "main-model");
  assert.equal(out.ocrError, null);
  assert.equal(out.parsed.storeName, "From Gemini");
});

test("main Gemini model fails -> fallback model answers", async () => {
  const tried = [];
  const out = await scanReceipt(Buffer.from("x"), "image/jpeg", {
    geminiModels: () => ["main-model", "lite-model"],
    parseReceiptWithGemini: async (_buf, _mime, { model }) => {
      tried.push(model);
      if (model === "main-model") throw new Error("503 high demand");
      return { storeName: "From lite", lineItems: [], confidence: {} };
    },
  });
  assert.deepEqual(tried, ["main-model", "lite-model"]);
  assert.equal(out.engine, "gemini");
  assert.equal(out.model, "lite-model");
});

test("every Gemini model fails -> manual entry, no throw", async () => {
  const out = await scanReceipt(Buffer.from("x"), "application/pdf", {
    geminiModels: () => ["main-model", "lite-model"],
    parseReceiptWithGemini: failing,
  });
  assert.equal(out.engine, null);
  assert.equal(out.model, null);
  assert.equal(out.ocrError, MANUAL_ENTRY_MESSAGE);
  assert.equal(out.parsed.storeName, null);
  assert.deepEqual(out.parsed.lineItems, []);
});

test("no models configured -> manual entry", async () => {
  const out = await scanReceipt(Buffer.from("x"), "image/jpeg", {
    geminiModels: () => [],
    parseReceiptWithGemini: async () => geminiParsed,
  });
  assert.equal(out.engine, null);
  assert.equal(out.ocrError, MANUAL_ENTRY_MESSAGE);
});
