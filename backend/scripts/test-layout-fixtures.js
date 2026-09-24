"use strict";

const fs = require("fs");
const path = require("path");
const { extractLineItemsFromLayout } = require("../src/lib/extractLineItemsFromLayout");

const results = [];

for (let n = 1; n <= 6; n++) {
  const file = path.join(__dirname, "receipt-test-results", `receipt-${n}-layout.json`);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const words = data.words;

  const out = extractLineItemsFromLayout(words, { debug: true });

  console.log(`\n===== Receipt ${n} =====`);
  console.log(`  words in: ${words.length}`);
  console.log(`  orientation correction applied: ${out.orientationDeg.toFixed(1)}°`);
  console.log(`  watermark/off-axis words dropped: ${out.watermarkDropped}`);
  console.log(`  header found: ${out.headerFound}`);
  if (out.headerFound) {
    console.log(`  header row text: "${out.headerRowText}"`);
    console.log(`  column map: ${JSON.stringify(out.columnMap)}`);
  }
  console.log(`  line items extracted: ${out.lineItems.length}`);
  out.lineItems.forEach((item, i) => {
    console.log(
      `    [${i}] qty=${item.qty ?? "null"} unit=${item.unit ?? "null"} desc=${item.description ?? "null"} price=${item.price ?? "null"} amount=${item.amount ?? "null"}`
    );
  });

  results.push({
    receipt: n,
    wordsIn: words.length,
    orientationDeg: out.orientationDeg,
    watermarkDropped: out.watermarkDropped,
    headerFound: out.headerFound,
    lineItemCount: out.lineItems.length,
  });
}

console.log("\n\n===== SUMMARY =====");
console.table(results);

const totalItems = results.reduce((s, r) => s + r.lineItemCount, 0);
console.log(`\nTOTAL line items across all 6 receipts: ${totalItems}`);
