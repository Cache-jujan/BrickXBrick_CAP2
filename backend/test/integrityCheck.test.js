// Unit tests for F12 integrity checking (lib/integrityCheck.js) and alert
// review (lib/tamperAlerts.js). A small in-memory fake stands in for the
// database and the chain, so these run without Postgres or Geth.
const test = require("node:test");
const assert = require("node:assert/strict");

const { checkExpenseIntegrity, runIntegrityScan } = require("../src/lib/integrityCheck");
const { raiseTamperAlert, resolveTamperAlert } = require("../src/lib/tamperAlerts");
const { canonicalizeExpense } = require("../src/lib/blockchainService");

const EXP = "11111111-1111-1111-1111-111111111111";
const APPROVER = "22222222-2222-2222-2222-222222222222";
const GM2 = "33333333-3333-3333-3333-333333333333";

function makeExpense(overrides = {}) {
  return {
    expenseid: EXP,
    projectid: "44444444-4444-4444-4444-444444444444",
    submittedby: "55555555-5555-5555-5555-555555555555",
    approvedby: APPROVER,
    vendorname: "Sample Hardware",
    amount: "1000.00",
    receiptdate: "2026-09-01",
    category: "Materials",
    birvalidationstatus: "Formal",
    quantity: 10,
    blockchainstatus: "Confirmed",
    ...overrides,
  };
}

// Fake DB: logs, alerts and expense status in memory; every SQL call recorded.
function fakeDb({ logs = [], alerts = [], expenses = [] } = {}) {
  const state = { logs, alerts, expenses, status: {}, notifications: [], calls: [] };
  async function query(sql, params = []) {
    state.calls.push(sql);
    const s = sql.replace(/\s+/g, " ");
    if (s.includes("FROM BlockchainLogs") && s.includes("ORDER BY timestamp ASC")) {
      const rows = state.logs.filter((l) => l.expenseid === params[0]).sort((a, b) => a.timestamp - b.timestamp);
      return { rows: rows.slice(0, 1), rowCount: Math.min(rows.length, 1) };
    }
    if (s.startsWith("UPDATE Expenses SET blockchainStatus = 'Confirmed'")) {
      state.status[params[0]] = "Confirmed";
      return { rowCount: 1, rows: [] };
    }
    if (s.startsWith("UPDATE Expenses SET blockchainStatus = 'TamperDetected'")) {
      state.status[params[0]] = "TamperDetected";
      return { rowCount: 1, rows: [] };
    }
    if (s.startsWith("UPDATE tamper_alerts SET restoredAt")) {
      state.alerts.filter((a) => a.expenseid === params[0] && !a.restoredat).forEach((a) => (a.restoredat = new Date()));
      return { rowCount: 1, rows: [] };
    }
    if (s.includes("FROM tamper_alerts WHERE expenseID = $1::uuid AND recomputedHash = $2")) {
      const rows = state.alerts.filter((a) => a.expenseid === params[0] && a.recomputedhash === params[1] && !a.restoredat);
      return { rows, rowCount: rows.length };
    }
    if (s.startsWith("INSERT INTO tamper_alerts")) {
      const alert = { alertid: `alert-${state.alerts.length + 1}`, expenseid: params[0], recomputedhash: params[1], onchainhash: params[2], resolvedat: null, restoredat: null };
      state.alerts.push(alert);
      return { rows: [alert], rowCount: 1 };
    }
    if (s.includes("FROM users WHERE status = 'Active'")) {
      return { rows: [{ userid: "admin-1" }, { userid: APPROVER }, { userid: GM2 }], rowCount: 3 };
    }
    if (s.startsWith("INSERT INTO notifications")) {
      state.notifications.push({ to: params[0], message: params[2] });
      return { rowCount: 1, rows: [] };
    }
    if (s.startsWith("UPDATE tamper_alerts SET notifiedSysAdmin")) return { rowCount: 1, rows: [] };
    if (s.startsWith("SELECT e.* FROM Expenses e")) {
      return { rows: state.expenses, rowCount: state.expenses.length };
    }
    if (s.includes("FROM tamper_alerts ta JOIN Expenses e")) {
      const a = state.alerts.find((x) => x.alertid === params[0]);
      if (!a) return { rows: [], rowCount: 0 };
      const e = makeExpense();
      return { rows: [{ alertid: a.alertid, resolvedat: a.resolvedat, expenseid: e.expenseid, approvedby: e.approvedby, vendorname: e.vendorname, amount: e.amount, projectid: e.projectid }], rowCount: 1 };
    }
    if (s.startsWith("UPDATE tamper_alerts SET resolvedAt")) {
      const a = state.alerts.find((x) => x.alertid === params[0] && !x.resolvedat);
      if (!a) return { rows: [], rowCount: 0 };
      Object.assign(a, { resolvedat: new Date(), resolvedby: params[1], resolutionnote: params[2] });
      return { rows: [a], rowCount: 1 };
    }
    throw new Error(`fake db: unexpected SQL: ${s.slice(0, 80)}`);
  }
  return { query, state };
}

const approvedHash = canonicalizeExpense(makeExpense());
const firstLog = { expenseid: EXP, txhash: "0xfirst", blocknumber: 10, timestamp: 1 };

test("no chain record yet: NotSecured, nothing written", async () => {
  const db = fakeDb();
  const r = await checkExpenseIntegrity(makeExpense(), { query: db.query, getOnChainHash: async () => approvedHash });
  assert.equal(r.state, "NotSecured");
  assert.equal(db.state.alerts.length, 0);
});

test("chain unreachable: not tampering, nothing written", async () => {
  const db = fakeDb({ logs: [firstLog] });
  const r = await checkExpenseIntegrity(makeExpense(), {
    query: db.query,
    getOnChainHash: async () => { throw new Error("ECONNREFUSED"); },
  });
  assert.equal(r.state, "Unreachable");
  assert.deepEqual(db.state.status, {});
  assert.equal(db.state.alerts.length, 0);
});

test("unchanged expense matches and is marked Confirmed", async () => {
  const db = fakeDb({ logs: [firstLog] });
  const r = await checkExpenseIntegrity(makeExpense({ blockchainstatus: "Pending" }), {
    query: db.query,
    getOnChainHash: async () => approvedHash,
  });
  assert.equal(r.state, "Match");
  assert.equal(db.state.status[EXP], "Confirmed");
});

test("changed amount: TamperDetected, one alert, SysAdmins and GMs notified", async () => {
  const db = fakeDb({ logs: [firstLog] });
  const r = await checkExpenseIntegrity(makeExpense({ amount: "9000.00" }), {
    query: db.query,
    getOnChainHash: async () => approvedHash,
  });
  assert.equal(r.state, "Mismatch");
  assert.equal(r.alertCreated, true);
  assert.equal(db.state.status[EXP], "TamperDetected");
  assert.equal(db.state.alerts.length, 1);
  assert.equal(db.state.notifications.length, 3);
});

test("status edited back to 'Confirmed' hides nothing: the check recomputes it", async () => {
  const db = fakeDb({ logs: [firstLog] });
  const r = await checkExpenseIntegrity(makeExpense({ amount: "9000.00", blockchainstatus: "Confirmed" }), {
    query: db.query,
    getOnChainHash: async () => approvedHash,
  });
  assert.equal(r.state, "Mismatch");
  assert.equal(db.state.status[EXP], "TamperDetected");
});

test("checking the same change again does not pile up alerts", async () => {
  const db = fakeDb({ logs: [firstLog] });
  const deps = { query: db.query, getOnChainHash: async () => approvedHash };
  await checkExpenseIntegrity(makeExpense({ amount: "9000.00" }), deps);
  const second = await checkExpenseIntegrity(makeExpense({ amount: "9000.00" }), deps);
  assert.equal(second.alertCreated, false);
  assert.equal(db.state.alerts.length, 1);
});

test("deleting the alert row doesn't hide it: the next check creates it again", async () => {
  const db = fakeDb({ logs: [firstLog] });
  const deps = { query: db.query, getOnChainHash: async () => approvedHash };
  await checkExpenseIntegrity(makeExpense({ amount: "9000.00" }), deps);
  db.state.alerts.length = 0; // someone deleted it in the database
  const again = await checkExpenseIntegrity(makeExpense({ amount: "9000.00" }), deps);
  assert.equal(again.alertCreated, true);
  assert.equal(db.state.alerts.length, 1);
});

test("a second, different change gets its own alert", async () => {
  const db = fakeDb({ logs: [firstLog] });
  const deps = { query: db.query, getOnChainHash: async () => approvedHash };
  await checkExpenseIntegrity(makeExpense({ amount: "9000.00" }), deps);
  await checkExpenseIntegrity(makeExpense({ amount: "9500.00" }), deps);
  assert.equal(db.state.alerts.length, 2);
});

test("verification uses the FIRST chain record, not a newer one written later", async () => {
  const tamperedHash = canonicalizeExpense(makeExpense({ amount: "9000.00" }));
  const laterLog = { expenseid: EXP, txhash: "0xlater", blocknumber: 99, timestamp: 2 };
  const db = fakeDb({ logs: [laterLog, firstLog] });
  const chain = { "0xfirst": approvedHash, "0xlater": tamperedHash };
  const r = await checkExpenseIntegrity(makeExpense({ amount: "9000.00" }), {
    query: db.query,
    getOnChainHash: async (tx) => chain[tx],
  });
  assert.equal(r.log.txhash, "0xfirst");
  assert.equal(r.state, "Mismatch");
});

test("data restored to approved values: Confirmed again, alert kept and stamped restored", async () => {
  const db = fakeDb({ logs: [firstLog] });
  const deps = { query: db.query, getOnChainHash: async () => approvedHash };
  await checkExpenseIntegrity(makeExpense({ amount: "9000.00" }), deps);
  const r = await checkExpenseIntegrity(makeExpense(), deps);
  assert.equal(r.state, "Match");
  assert.equal(db.state.alerts.length, 1);
  assert.ok(db.state.alerts[0].restoredat);
});

test("chain record missing on the chain counts as a mismatch", async () => {
  const db = fakeDb({ logs: [firstLog] });
  const r = await checkExpenseIntegrity(makeExpense(), { query: db.query, getOnChainHash: async () => null });
  assert.equal(r.state, "Mismatch");
  assert.equal(db.state.alerts[0].onchainhash, "MISSING");
});

test("scan covers secured expenses whatever their status, and stops if the chain is down", async () => {
  const expenses = [makeExpense({ blockchainstatus: "Pending", amount: "9000.00" }), makeExpense({ expenseid: "x2" })];
  const db = fakeDb({ logs: [firstLog], expenses });
  const counts = await runIntegrityScan({ query: db.query, getOnChainHash: async () => approvedHash });
  assert.equal(counts.mismatch, 1);
  assert.ok(db.state.calls.some((c) => /ORDER BY e\.lastIntegrityCheckAt ASC NULLS FIRST/.test(c)));
  assert.ok(!db.state.calls.some((c) => /blockchainStatus = 'Confirmed' LIMIT/.test(c)));

  const down = fakeDb({ logs: [firstLog], expenses });
  const c2 = await runIntegrityScan({ query: down.query, getOnChainHash: async () => { throw new Error("down"); } });
  assert.equal(c2.unreachable, 1);
  assert.equal(c2.checked, 1);
});

test("review needs a reason of at least 10 characters", async () => {
  const db = fakeDb();
  await raiseTamperAlert(makeExpense(), "h1", approvedHash, "test", { query: db.query });
  await assert.rejects(
    resolveTamperAlert({ alertId: "alert-1", user: { id: GM2, role: "General Manager" }, note: "ok" }, { query: db.query }),
    (e) => e.status === 400
  );
});

test("whoever approved the expense can't review its alert", async () => {
  const db = fakeDb();
  await raiseTamperAlert(makeExpense(), "h1", approvedHash, "test", { query: db.query });
  await assert.rejects(
    resolveTamperAlert({ alertId: "alert-1", user: { id: APPROVER, role: "General Manager" }, note: "Checked the receipt, it is fine" }, { query: db.query }),
    (e) => e.status === 403
  );
});

test("review keeps who, when and why; others are notified; can't be reviewed twice", async () => {
  const db = fakeDb();
  await raiseTamperAlert(makeExpense(), "h1", approvedHash, "test", { query: db.query });
  db.state.notifications.length = 0;
  const done = await resolveTamperAlert(
    { alertId: "alert-1", user: { id: GM2, name: "Second GM", role: "General Manager" }, note: "Vendor re-issued the receipt; original kept on file" },
    { query: db.query }
  );
  assert.equal(done.resolvedby, GM2);
  assert.match(done.resolutionnote, /re-issued/);
  assert.ok(done.resolvedat);
  assert.equal(db.state.notifications.length, 2); // everyone except the reviewer
  assert.ok(db.state.notifications.every((n) => n.to !== GM2));
  await assert.rejects(
    resolveTamperAlert({ alertId: "alert-1", user: { id: "admin-1", role: "System Administrator" }, note: "Trying to change it" }, { query: db.query }),
    (e) => e.status === 409
  );
});
