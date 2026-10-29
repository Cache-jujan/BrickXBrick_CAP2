const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createReceiptScans,
  parseContext,
  isStale,
  STALE_AFTER_MS,
  STALE_MESSAGE,
  FAILED_MESSAGE,
} = require("../src/lib/receiptScans");

// Records every query; SELECTs answer with `rows`.
function fakeDatabase(rows = []) {
  const calls = [];
  async function query(sql, params) {
    calls.push({ sql, params });
    if (/^\s*SELECT/i.test(sql)) return { rowCount: rows.length, rows };
    if (/^\s*INSERT/i.test(sql)) return { rowCount: 1, rows: [{ scanID: "scan-1", status: "Scanning" }] };
    return { rowCount: 1, rows: [] };
  }
  return { query, calls };
}

const updates = (db) => db.calls.filter((c) => /^\s*UPDATE/i.test(c.sql));

test("a finished scan is saved as Ready with its draft", async () => {
  const db = fakeDatabase();
  const scans = createReceiptScans({ query: db.query, buildScanDraft: async () => ({ vendorName: "Sample Hardware", amount: 100 }) });
  await scans.runScan("scan-1", Buffer.from("x"), "image/jpeg", "http://x/receipts/files/a.jpg");
  const [update] = updates(db);
  assert.match(update.sql, /status = 'Ready'/);
  assert.match(update.sql, /status = 'Scanning'/); // never overwrites a settled row
  assert.deepEqual(JSON.parse(update.params[1]), { vendorName: "Sample Hardware", amount: 100 });
});

test("a crash while scanning marks the scan Failed instead of throwing", async () => {
  const db = fakeDatabase();
  const scans = createReceiptScans({ query: db.query, buildScanDraft: async () => { throw new Error("boom"); } });
  await scans.runScan("scan-1", Buffer.from("x"), "image/jpeg", "url");
  const [update] = updates(db);
  assert.match(update.sql, /status = 'Failed'/);
  assert.equal(update.params[1], FAILED_MESSAGE);
});

test("runScan survives even when the Failed update itself fails", async () => {
  const scans = createReceiptScans({
    query: async () => { throw new Error("db down"); },
    buildScanDraft: async () => { throw new Error("boom"); },
  });
  await assert.doesNotReject(scans.runScan("scan-1", Buffer.from("x"), "image/jpeg", "url"));
});

test("a scan stuck in Scanning past the limit is reported and saved as Failed", async () => {
  const old = new Date(Date.now() - STALE_AFTER_MS - 1000).toISOString();
  const db = fakeDatabase([{ scanID: "scan-1", status: "Scanning", createdAt: old }]);
  const scans = createReceiptScans({ query: db.query, buildScanDraft: async () => ({}) });
  const scan = await scans.getScan("scan-1", "user-1");
  assert.equal(scan.status, "Failed");
  assert.equal(scan.errorMessage, STALE_MESSAGE);
  assert.equal(updates(db).length, 1);
});

test("a fresh Scanning row is left alone", async () => {
  const db = fakeDatabase([{ scanID: "scan-1", status: "Scanning", createdAt: new Date().toISOString() }]);
  const scans = createReceiptScans({ query: db.query, buildScanDraft: async () => ({}) });
  const [scan] = await scans.listScans("user-1");
  assert.equal(scan.status, "Scanning");
  assert.equal(updates(db).length, 0);
});

test("scans are always looked up for the calling user only", async () => {
  const db = fakeDatabase([]);
  const scans = createReceiptScans({ query: db.query, buildScanDraft: async () => ({}) });
  assert.equal(await scans.getScan("scan-1", "user-1"), null);
  await scans.listScans("user-1");
  await scans.dismissScan("scan-1", "user-1");
  for (const call of db.calls) assert.match(call.sql, /submittedBy = \$\d/i);
});

test("isStale only applies to Scanning rows", () => {
  const old = new Date(Date.now() - STALE_AFTER_MS - 1000).toISOString();
  assert.equal(isStale({ status: "Scanning", createdAt: old }), true);
  assert.equal(isStale({ status: "Ready", createdAt: old }), false);
});

test("context must be a small JSON object", () => {
  assert.deepEqual(parseContext('{"mode":"split"}'), { mode: "split" });
  assert.equal(parseContext("not json"), null);
  assert.equal(parseContext("[1,2]"), null);
  assert.equal(parseContext(undefined), null);
  assert.equal(parseContext(JSON.stringify({ big: "x".repeat(5000) })), null);
});

// A database that also answers UPDATE ... RETURNING with the scan's owner.
function fakeDatabaseWithOwner(ownerID) {
  const calls = [];
  async function query(sql, params) {
    calls.push({ sql, params });
    if (/^\s*UPDATE/i.test(sql) && /RETURNING/i.test(sql)) return { rowCount: 1, rows: [{ userID: ownerID }] };
    return { rowCount: 1, rows: [] };
  }
  return { query, calls };
}
const notifications = (db) => db.calls.filter((c) => /INSERT INTO notifications/i.test(c.sql));

test("a finished scan notifies its owner (Ready)", async () => {
  const db = fakeDatabaseWithOwner("user-9");
  const scans = createReceiptScans({ query: db.query, buildScanDraft: async () => ({ amount: 1 }) });
  await scans.runScan("scan-1", Buffer.from("x"), "image/jpeg", "url");
  const [note] = notifications(db);
  assert.equal(notifications(db).length, 1);
  assert.deepEqual([note.params[0], note.params[1], note.params[2]], ["user-9", "ReceiptScanReady", "scan-1"]);
  assert.match(note.sql, /'ReceiptScan'/);
});

test("a failed scan notifies its owner (Failed)", async () => {
  const db = fakeDatabaseWithOwner("user-9");
  const scans = createReceiptScans({ query: db.query, buildScanDraft: async () => { throw new Error("boom"); } });
  await scans.runScan("scan-1", Buffer.from("x"), "image/jpeg", "url");
  assert.equal(notifications(db)[0].params[1], "ReceiptScanFailed");
});

test("no notification when the scan was already settled (nothing updated)", async () => {
  const db = fakeDatabase(); // UPDATE returns no rows
  const scans = createReceiptScans({ query: db.query, buildScanDraft: async () => ({}) });
  await scans.runScan("scan-1", Buffer.from("x"), "image/jpeg", "url");
  assert.equal(notifications(db).length, 0);
});

test("a notification error never undoes the scan result", async () => {
  const calls = [];
  const scans = createReceiptScans({
    query: async (sql) => {
      calls.push(sql);
      if (/INSERT INTO notifications/i.test(sql)) throw new Error("constraint");
      return { rowCount: 1, rows: [{ userID: "user-9" }] };
    },
    buildScanDraft: async () => ({}),
  });
  await assert.doesNotReject(scans.runScan("scan-1", Buffer.from("x"), "image/jpeg", "url"));
  // Only one UPDATE: it did not fall through to the Failed path.
  assert.equal(calls.filter((c) => /^\s*UPDATE/i.test(c)).length, 1);
});
