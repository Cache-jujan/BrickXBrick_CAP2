import test from "node:test";
import assert from "node:assert/strict";

import { defaultQuantity, isFeeLine } from "../../fee-lines.js";

test("charges are fee lines, goods are not", () => {
  for (const d of ["VAT (12%)", "Delivery fee", "Freight", "Discount", "Service charge", "12% Value-Added Tax", "Rounding"]) {
    assert.equal(isFeeLine(d), true, d);
  }
  for (const d of ["Portland cement 40kg", "Rebar 10mm", "Tax-free sand", "", null]) {
    assert.equal(isFeeLine(d), false, String(d));
  }
});

test("a quantity OCR read is kept, even on a fee line", () => {
  assert.equal(defaultQuantity("Delivery", 1), "1");
  assert.equal(defaultQuantity("Cement", "30"), "30");
});

test("a fee line with no quantity starts at 0, a real item stays blank", () => {
  assert.equal(defaultQuantity("VAT", null), "0");
  assert.equal(defaultQuantity("Cement", null), "");
  assert.equal(defaultQuantity("Cement", "  "), "");
});
