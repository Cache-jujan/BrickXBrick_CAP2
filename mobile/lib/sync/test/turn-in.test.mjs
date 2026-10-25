import test from "node:test";
import assert from "node:assert/strict";

import { trayRows, traySummary } from "../../turn-in.js";

const scan = (id, over = {}) => ({ scanID: id, status: "Ready", createdAt: "2026-10-24T09:00:00Z", result: { vendorName: "Padeena", amount: "6100.50" }, ...over });
const queued = (id, over = {}) => ({ scan_id: id, sync_status: "PENDING", created_at: "2026-10-24T10:00:00Z", ...over });

test("each receipt gets one state", () => {
  const rows = trayRows(
    [scan("a"), scan("b", { status: "Scanning", result: null }), scan("c", { status: "Failed", result: null })],
    [queued("q1"), queued("q2", { sync_status: "REJECTED" })]
  );
  const states = Object.fromEntries(rows.map((r) => [r.key, r.state]));
  assert.deepEqual(states, { "s:a": "review", "s:b": "reading", "s:c": "failed", "q:q1": "waiting", "q:q2": "upload_failed" });
});

test("newest receipt comes first, phone and server mixed", () => {
  const rows = trayRows([scan("old", { createdAt: "2026-10-24T08:00:00Z" })], [queued("new")]);
  assert.deepEqual(rows.map((r) => r.key), ["q:new", "s:old"]);
});

test("vendor and amount only show once the receipt is read", () => {
  const [read, reading] = trayRows([scan("a"), scan("b", { status: "Scanning", result: { vendorName: "X", amount: 5 }, createdAt: "2026-10-24T07:00:00Z" })], []);
  assert.equal(read.vendor, "Padeena");
  assert.equal(read.amount, 6100.5);
  assert.equal(reading.vendor, null);
  assert.equal(reading.amount, null);
});

test("summary counts every receipt and totals the ones already read", () => {
  const rows = trayRows([scan("a"), scan("b", { result: { vendorName: "Z", amount: 900 } })], [queued("q")]);
  assert.deepEqual(traySummary(rows), { count: 3, total: 7000.5 });
});

test("tolerates non-arrays and unreadable amounts", () => {
  assert.deepEqual(trayRows(undefined, null), []);
  assert.equal(trayRows([scan("a", { result: { vendorName: "V", amount: null } })], [])[0].amount, null);
});

test("a gas / toll receipt is tagged as a trip cost, queued or scanned", () => {
  const rows = trayRows(
    [{ scanID: "s1", status: "Ready", createdAt: "2026-10-20T10:00:00Z", context: { kind: "trip" }, result: { amount: 500, vendorName: "Shell" } }],
    [{ scan_id: "q1", sync_status: "PENDING", created_at: "2026-10-20T11:00:00Z", context: { kind: "trip" } }]
  );
  assert.deepEqual(rows.map((r) => r.trip), [true, true]);
  const plain = trayRows([{ scanID: "s2", status: "Ready", createdAt: "2026-10-20T10:00:00Z", context: { mode: "split" }, result: {} }], []);
  assert.equal(plain[0].trip, false);
});
