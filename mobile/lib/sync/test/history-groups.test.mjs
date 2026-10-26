import test from "node:test";
import assert from "node:assert/strict";

import { dayKey, groupReceipts, rejectedCount, worstStatus } from "../../history-groups.js";

const at = (day, hour) => new Date(2026, 9, day, hour, 0, 0).toISOString();
const exp = (id, over = {}) => ({ expenseID: id, amount: "100.00", status: "Pending", submittedAt: at(24, 10), commonReceiptID: null, ...over });

test("dayKey uses the local calendar day and tolerates bad input", () => {
  assert.equal(dayKey(at(24, 9)), "2026-10-24");
  assert.equal(dayKey("nonsense"), "");
});

test("groups newest day first and newest receipt first within a day", () => {
  const out = groupReceipts([exp("a", { submittedAt: at(23, 9) }), exp("b", { submittedAt: at(24, 8) }), exp("c", { submittedAt: at(24, 15) })]);
  assert.deepEqual(out.map((d) => d.day), ["2026-10-24", "2026-10-23"]);
  assert.deepEqual(out[0].receipts.map((r) => r.items[0].expenseID), ["c", "b"]);
});

test("portions of one split receipt become one receipt with a summed total", () => {
  const out = groupReceipts([
    exp("p1", { commonReceiptID: "X", amount: "6100.00" }),
    exp("p2", { commonReceiptID: "X", amount: "320.50" }),
    exp("solo"),
  ]);
  const receipts = out[0].receipts;
  assert.equal(receipts.length, 2);
  const split = receipts.find((r) => r.key === "r:X");
  assert.equal(split.items.length, 2);
  assert.equal(Math.round(split.total * 100), 642050);
});

test("a receipt shows its worst status", () => {
  assert.equal(worstStatus([exp("a", { status: "Approved" }), exp("b", { status: "Rejected" })]), "Rejected");
  assert.equal(worstStatus([exp("a", { status: "Approved" }), exp("b", { status: "Pending" })]), "Pending");
  assert.equal(worstStatus([exp("a", { status: "Approved" })]), "Approved");
});

test("rejectedCount counts only rejected expenses and handles non-arrays", () => {
  assert.equal(rejectedCount([exp("a", { status: "Rejected" }), exp("b"), exp("c", { status: "Rejected" })]), 2);
  assert.equal(rejectedCount(null), 0);
  assert.deepEqual(groupReceipts(undefined), []);
});
