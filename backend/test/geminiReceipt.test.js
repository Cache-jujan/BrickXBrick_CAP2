const test = require("node:test");
const assert = require("node:assert/strict");

const { geminiJsonToParsed, extractReceiptJson } = require("../src/lib/geminiReceipt");
const { toExpenseDraft, classifyBir } = require("../src/lib/receiptFields");

// FAKE receipt values only — see the confidentiality note in geminiReceipt.js.
const fullReceipt = {
  storeName: "Sample Hardware Trading",
  tin: "111-222-333-00000",
  birPermitType: "ATP",
  birPermitNumber: "080AU20260000009999",
  orSiNumber: "004512",
  date: "2026-10-09",
  amount: 1250.5,
  lineItems: [
    { description: "Portland cement 40kg", quantity: 4, unitPrice: 262.5, amount: 1050 },
    { description: "Tie wire #16", quantity: 2, unitPrice: 100.25, amount: 200.5 },
  ],
  uncertainFields: [],
};

test("maps a full Gemini reading onto the parseReceiptText shape", () => {
  const parsed = geminiJsonToParsed(fullReceipt);
  assert.equal(parsed.storeName, "Sample Hardware Trading");
  assert.equal(parsed.orSiNumber, "004512");
  assert.equal(parsed.birPermitType, "ATP");
  assert.equal(parsed.amount, "1250.5"); // string, like the regex parser
  assert.equal(parsed.date, "2026-10-09");
  assert.equal(parsed.lineItems.length, 2);
  assert.deepEqual(parsed.confidence, {
    vendorName: "medium", date: "medium", amount: "medium", tin: "medium", birPermitNumber: "medium", orSiNumber: "medium",
  });
});

test("the contract holds: toExpenseDraft and classifyBir (F7) work unchanged", () => {
  const draft = toExpenseDraft(geminiJsonToParsed(fullReceipt));
  assert.equal(draft.vendorName, "Sample Hardware Trading");
  assert.equal(draft.birNumber, "004512");
  assert.equal(draft.amount, 1250.5);
  assert.equal(draft.quantity, 6);
  assert.equal(classifyBir(draft).birValidationStatus, "Formal-Tax-Deductible");
});

test("missing and self-reported uncertain fields are low confidence", () => {
  const parsed = geminiJsonToParsed({ ...fullReceipt, tin: null, uncertainFields: ["amount"] });
  assert.equal(parsed.tin, null);
  assert.equal(parsed.confidence.tin, "low");
  assert.equal(parsed.confidence.amount, "low");
  assert.equal(parsed.confidence.vendorName, "medium");
  assert.equal(classifyBir(toExpenseDraft(parsed)).birValidationStatus, "Informal");
});

test("junk values are dropped rather than passed on", () => {
  const parsed = geminiJsonToParsed({
    storeName: "  ",
    tin: "N/A",
    birPermitType: "something",
    birPermitNumber: "null",
    orSiNumber: null,
    date: "10/09/26",
    amount: "₱1,250.50",
    lineItems: [{ description: "", amount: 5 }, { description: "Nails", quantity: 2, unitPrice: 15 }, { description: "No price" }],
  });
  assert.equal(parsed.storeName, null);
  assert.equal(parsed.tin, null);
  assert.equal(parsed.birPermitType, null);
  assert.equal(parsed.birPermitNumber, null);
  assert.equal(parsed.date, null); // not YYYY-MM-DD
  assert.equal(parsed.amount, "1250.5");
  assert.deepEqual(parsed.lineItems.map((i) => [i.description, i.amount]), [["Nails", 30]]);
});

test("impossible dates are rejected", () => {
  assert.equal(geminiJsonToParsed({ date: "2026-02-30" }).date, null);
  assert.equal(geminiJsonToParsed({ date: "1999-12-31" }).date, null);
});

test("a non-object response maps to an empty, all-low draft", () => {
  const parsed = geminiJsonToParsed(null);
  assert.equal(parsed.storeName, null);
  assert.deepEqual(parsed.lineItems, []);
  assert.equal(parsed.confidence.amount, "low");
});

test("extractReceiptJson sends the bytes inline and asks for JSON", async () => {
  let request;
  const gemini = {
    models: {
      generateContent: async (req) => {
        request = req;
        return { text: JSON.stringify(fullReceipt) };
      },
    },
  };
  const json = await extractReceiptJson(Buffer.from("fake"), "image/jpeg", { gemini, model: "test-model" });
  assert.equal(json.storeName, "Sample Hardware Trading");
  assert.equal(request.model, "test-model");
  assert.equal(request.config.responseMimeType, "application/json");
  const inline = request.contents[0].parts[0].inlineData;
  assert.equal(inline.mimeType, "image/jpeg");
  assert.equal(inline.data, Buffer.from("fake").toString("base64"));
});

test("extractReceiptJson rejects invalid JSON", async () => {
  const gemini = { models: { generateContent: async () => ({ text: "not json" }) } };
  await assert.rejects(extractReceiptJson(Buffer.from("x"), "image/png", { gemini }), /invalid JSON/);
});

test("model float noise is rounded to centavos", () => {
  const parsed = geminiJsonToParsed({
    amount: 5550.000000000001,
    lineItems: [{ description: "Masonry cement", quantity: 30, unitPrice: 185.00000000000003, amount: null }],
  });
  assert.equal(parsed.amount, "5550");
  assert.equal(parsed.lineItems[0].unitPrice, 185);
  assert.equal(parsed.lineItems[0].amount, 5550);
});

test("the schema requires every line-item column so amounts aren't skipped", () => {
  const { extractReceiptJson: _unused, ...lib } = require("../src/lib/geminiReceipt");
  let schema;
  const gemini = { models: { generateContent: async (req) => { schema = req.config.responseSchema; return { text: "{}" }; } } };
  return extractReceiptJson(Buffer.from("x"), "image/png", { gemini }).then(() => {
    assert.deepEqual(schema.properties.lineItems.items.required, ["description", "quantity", "unitPrice", "amount"]);
    assert.equal(typeof lib.PROMPT_VERSION, "number");
  });
});
