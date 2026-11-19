import test from "node:test";
import assert from "node:assert/strict";

import { snappedFor, trayRows, traySummary } from "../../turn-in.js";

const scan = (id, over = {}) => ({ scanID: id, status: "Ready", createdAt: "2026-10-24T09:00:00Z", result: { vendorName: "Padeena", amount: "6100.50" }, ...over });
const queued = (id, over = {}) => ({ scan_id: id, sync_status: "PENDING", created_at: "2026-10-24T10:00:00Z", ...over });

test("a file that is not a receipt gets its own tray state", () => {
  const [row] = trayRows([scan("n", { status: "Failed", result: { notReceipt: true } })], []);
  assert.equal(row.state, "not_receipt");
});

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

test("a receipt opened from a request names that request and its project", () => {
  const ticket = { subject: "Cement 40kg", projectName: "Mabolo Duplex" };
  const [row] = trayRows([scan("n", { status: "Failed", result: { notReceipt: true }, context: { mode: "single", ticket, fileName: "IMG_1.jpg" } })], []);
  assert.equal(row.request, "Cement 40kg");
  assert.equal(row.project, "Mabolo Duplex");
  assert.equal(row.fileName, "IMG_1.jpg");
});

test("a snap-now receipt names the projects it was scoped to, or none", () => {
  assert.deepEqual(snappedFor({ mode: "split", ticket: null, projectNames: ["A", "B"] }), { request: null, project: "A, B" });
  assert.deepEqual(snappedFor({ mode: "split", ticket: null }), { request: null, project: null });
  assert.deepEqual(snappedFor(null), { request: null, project: null });
});

test("a receipt still on the phone keeps its request and file name", () => {
  const [row] = trayRows([], [queued("q", { file_name: "r.pdf", context: { ticket: { subject: "Rebar", projectName: "P1" } } })]);
  assert.deepEqual([row.request, row.project, row.fileName], ["Rebar", "P1", "r.pdf"]);
});
