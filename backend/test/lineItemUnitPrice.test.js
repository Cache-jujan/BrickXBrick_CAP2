// A missing unit price is derived from the row total: quantity 3, amount 300 -> 100 each.
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeLineItems } = require("../src/lib/receiptFields");

const one = (item) => normalizeLineItems([{ description: "Cement", ...item }])[0];

test("a blank unit price is derived from amount / quantity", () => {
  assert.equal(one({ quantity: 3, amount: 300 }).unitPrice, 100);
  assert.equal(one({ quantity: 3, amount: 300, unitPrice: null }).unitPrice, 100);
});

test("a derived unit price is rounded to centavos", () => {
  assert.equal(one({ quantity: 3, amount: 100 }).unitPrice, 33.33);
});

test("a unit price the receipt gave is kept", () => {
  assert.equal(one({ quantity: 2, amount: 250, unitPrice: 125 }).unitPrice, 125);
});

test("a 0 unit price on a priced line is treated as missing", () => {
  assert.equal(one({ quantity: 4, amount: 200, unitPrice: 0 }).unitPrice, 50);
});

test("fee lines (quantity 0) have no unit price to derive", () => {
  assert.equal(one({ quantity: 0, amount: 150 }).unitPrice, null);
  assert.equal(one({ amount: 150 }).unitPrice, null);
});
