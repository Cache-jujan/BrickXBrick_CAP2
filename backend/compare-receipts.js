
const fs = require("fs");

console.log("\n================ RECEIPT OCR COMPARISON ================\n");

for (let i = 1; i <= 6; i++) {
  const file = `scripts/receipt-test-results/receipt-${i}.json`;

  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));

    console.log(`========== RECEIPT ${i} ==========`);
    console.log("Vendor:             ", data.vendorName);
    console.log("Date:               ", data.receiptDate);
    console.log("Amount:             ", data.amount);
    console.log("TIN:                ", data.tin);
    console.log("BIR Permit Number:  ", data.birPermitNumber);
    console.log("BIR/OR-SI Number:   ", data.birNumber);
    console.log(
      "Line Items:         ",
      Array.isArray(data.lineItems) ? data.lineItems.length : "N/A"
    );
    console.log("Quantity:           ", data.quantity);
    console.log("BIR Status:         ", data.birValidationStatus);
    console.log("Missing BIR Fields: ", data.missingBirFields);
    console.log("OCR Error:          ", data.ocrError);
    console.log("Confidence:         ", data.confidence);
    console.log("Receipt URL:        ", data.receiptImageURL);
    console.log();
  } catch (err) {
    console.log(`========== RECEIPT ${i} ERROR ==========`);
    console.log(err.message);
    console.log();
  }
}
