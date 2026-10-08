// eval-ocr.js — offline accuracy check for the receipt parser.
//
// Runs the parser over the Vision output already saved for the receipts in
// scripts/receipt-img (rawText in receipt-test-results/receipt-N.json, word
// boxes in receipt-N-layout.json). No Vision calls, no credentials, no DB.
//
//   node scripts/ocr-eval/eval-ocr.js            # current parser
//   node scripts/ocr-eval/eval-ocr.js --layout   # with layout line items
//   node scripts/ocr-eval/eval-ocr.js --verbose  # print every miss
//
// Add a receipt: save its Vision output with dump-vision-layout.js and the
// raw-text dump, then add its correct values to expected.json. Only list
// fields you have checked against the paper receipt.

const fs = require("fs");
const path = require("path");

const { parseReceiptText } = require("../../src/lib/parser");
const { toExpenseDraft } = require("../../src/lib/receiptFields");
const { lineItemsFromWords } = require("../../src/lib/layoutLineItems");

const args = new Set(process.argv.slice(2));
const useLayout = args.has("--layout");
const verbose = args.has("--verbose");

const RESULTS = path.join(__dirname, "..", "receipt-test-results");
const expected = JSON.parse(fs.readFileSync(path.join(__dirname, "expected.json"), "utf8"));

const alnum = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, "");
const code = (v) => String(v).toUpperCase().replace(/[\s-]+/g, "");
const cents = (v) => Math.round(Number(v) * 100);

// How each field is compared. null expected means "should be empty".
const SAME = {
  vendorName: (got, want) => alnum(got).includes(alnum(want)) || alnum(want).includes(alnum(got)),
  tin: (got, want) => String(got).replace(/\D/g, "").slice(0, 9) === String(want).replace(/\D/g, "").slice(0, 9),
  birPermitNumber: (got, want) => code(got) === code(want),
  birNumber: (got, want) => code(got).replace(/^0+/, "") === code(want).replace(/^0+/, ""),
  receiptDate: (got, want) => got === want,
  amount: (got, want) => cents(got) === cents(want),
  lineItemCount: (got, want) => got === want,
  lineItemSum: (got, want) => cents(got) === cents(want),
};

function draftFor(n) {
  const saved = JSON.parse(fs.readFileSync(path.join(RESULTS, `receipt-${n}.json`), "utf8"));
  const parsed = parseReceiptText(saved.rawText || "");
  if (useLayout) {
    const layoutFile = path.join(RESULTS, `receipt-${n}-layout.json`);
    if (fs.existsSync(layoutFile)) {
      const { words } = JSON.parse(fs.readFileSync(layoutFile, "utf8"));
      const fromLayout = lineItemsFromWords(words);
      if (fromLayout) parsed.lineItems = fromLayout;
    }
  }
  const draft = toExpenseDraft(parsed);
  return {
    ...draft,
    lineItemCount: draft.lineItems.length,
    lineItemSum: draft.lineItems.reduce((s, i) => s + i.amount, 0),
  };
}

const perField = {};
let hits = 0;
let total = 0;

for (const [n, want] of Object.entries(expected)) {
  if (n.startsWith("_")) continue;
  const got = draftFor(n);
  for (const [field, wantValue] of Object.entries(want)) {
    const gotValue = got[field];
    const ok = wantValue === null
      ? gotValue === null || gotValue === undefined || gotValue === ""
      : gotValue !== null && gotValue !== undefined && SAME[field](gotValue, wantValue);
    perField[field] = perField[field] || { hit: 0, total: 0 };
    perField[field].total += 1;
    total += 1;
    if (ok) { perField[field].hit += 1; hits += 1; }
    else if (verbose) console.log(`  receipt ${n} ${field}: got ${JSON.stringify(gotValue)}, want ${JSON.stringify(wantValue)}`);
  }
}

console.log(`\nOCR parser eval${useLayout ? " (layout line items)" : ""} — ${Object.keys(expected).filter((k) => !k.startsWith("_")).length} receipts\n`);
for (const [field, { hit, total: t }] of Object.entries(perField)) {
  console.log(`  ${field.padEnd(16)} ${String(hit).padStart(2)}/${t}`);
}
console.log(`  ${"overall".padEnd(16)} ${String(hits).padStart(2)}/${total}  (${Math.round((100 * hits) / total)}%)\n`);
