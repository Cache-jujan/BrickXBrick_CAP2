import test from "node:test";
import assert from "node:assert/strict";

import { groupByVendor, otherRequests, progressOf } from "../../to-buy.js";

const req = (id, over = {}) => ({
  ticketID: id,
  vendorName: "Padeena Enterprises",
  requestedQuantity: 50,
  remainingQuantity: 50,
  approvedBudget: 10000,
  remainingBudget: 10000,
  createdAt: "2026-10-20T08:00:00Z",
  ...over,
});

test("progress shows what is bought so far in quantity and money", () => {
  const p = progressOf(req("a", { remainingQuantity: 20, remainingBudget: 3900 }));
  assert.equal(p.bought, 30);
  assert.equal(p.requested, 50);
  assert.equal(p.quantityShare, 0.6);
  assert.equal(p.spent, 6100);
  assert.equal(p.budget, 10000);
  assert.equal(p.started, true);
});

test("a request nothing was bought for has not started", () => {
  const p = progressOf(req("a"));
  assert.equal(p.bought, 0);
  assert.equal(p.started, false);
});

test("progress copes with no budget and with odd numbers", () => {
  const p = progressOf(req("a", { approvedBudget: null, remainingBudget: null, remainingQuantity: 60 }));
  assert.equal(p.spent, null);
  assert.equal(p.budget, null);
  assert.equal(p.bought, 0); // never negative
  assert.equal(progressOf(req("b", { requestedQuantity: "x" })).quantityShare, null);
});

test("groups by store regardless of case or spacing, stores A to Z, no-store last", () => {
  const groups = groupByVendor([
    req("1", { vendorName: "Zeta Hardware" }),
    req("2", { vendorName: null }),
    req("3", { vendorName: "  padeena enterprises " }),
    req("4", { vendorName: "Padeena Enterprises" }),
  ]);
  assert.deepEqual(groups.map((g) => g.vendorName), ["padeena enterprises", "Zeta Hardware", null]);
  assert.equal(groups[0].requests.length, 2);
});

test("oldest request comes first inside a store", () => {
  const groups = groupByVendor([req("late", { createdAt: "2026-10-22T08:00:00Z" }), req("early", { createdAt: "2026-10-18T08:00:00Z" })]);
  assert.deepEqual(groups[0].requests.map((r) => r.ticketID), ["early", "late"]);
});

test("groupByVendor tolerates non-arrays", () => {
  assert.deepEqual(groupByVendor(undefined), []);
});

test("other requests are assigned material requests the open list does not cover", () => {
  const assigned = [
    { ticketid: "t1", status: "Acknowledged", tickettype: "Material Request" },
    { ticketid: "t2", status: "Acknowledged", tickettype: "Material Request" },
    { ticketid: "t3", status: "Resolved", tickettype: "Material Request" },
    { ticketid: "t4", status: "Acknowledged", tickettype: "Report" },
  ];
  assert.deepEqual(otherRequests(assigned, [{ ticketID: "t1" }]).map((t) => t.ticketid), ["t2"]);
  assert.deepEqual(otherRequests(null, null), []);
});

import { filterByVendor, vendorOptions } from "../../to-buy.js";

test("stores to pick from are the named stores A to Z (no 'no store' option), and spelling variants are one store", () => {
  const options = vendorOptions([
    req("a", { vendorName: "Padeena Enterprises" }),
    req("b", { vendorName: " padeena enterprises " }),
    req("c", { vendorName: "Krislee" }),
    req("d", { vendorName: null }),
  ]);
  assert.deepEqual(options.map((o) => o.key), ["krislee", "padeena enterprises"]);
});

test("filtering by store keeps only its requests; null keeps all; '' keeps the ones with no store", () => {
  const list = [req("a", { vendorName: "Krislee" }), req("b", { vendorName: "Padeena Enterprises" }), req("c", { vendorName: null })];
  assert.deepEqual(filterByVendor(list, "krislee").map((r) => r.ticketID), ["a"]);
  assert.equal(filterByVendor(list, null).length, 3);
  assert.deepEqual(filterByVendor(list, "").map((r) => r.ticketID), ["c"]);
});
