// Lines short of the receipt total can be adjusted; lines OVER the total never are
// (no discount is taken off an item: the Purchaser has to correct the amounts).
import test from "node:test";
import assert from "node:assert/strict";
import { reconcileFix } from "../../receipt-checks.ts";

const lines = [
  { id: "a", name: "Cement", cents: 500000 },
  { id: "b", name: "Sand", cents: 100000 },
];

test("lines short of the total: one tap adds an adjustment for the gap", () => {
  assert.deepEqual(reconcileFix(610000, lines), { kind: "add", gapCents: 10000 });
});

test("lines over the total: no fix is offered (no discount off an item)", () => {
  assert.equal(reconcileFix(590000, lines), null);
});

test("totals that already match need no fix", () => {
  assert.equal(reconcileFix(600000, lines), null);
});

test("an unreadable line amount gives no fix", () => {
  assert.equal(reconcileFix(600000, [{ id: "a", name: "x", cents: null }]), null);
});
