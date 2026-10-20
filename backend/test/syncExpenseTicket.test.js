// F10 sync: the ticket auto-resolve must be part of the expense transaction.
// If the expense insert fails, the ticket must NOT be left Resolved.
// The route runs for real; the database and screening are in-memory fakes.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const TICKET = "33333333-3333-4333-8333-333333333333";
const PROJECT = "44444444-4444-4444-8444-444444444444";
const UUID = "55555555-5555-4555-8555-555555555555";
const state = { ticketStatus: "Acknowledged", failInsert: false, expenses: 0, synced: 0, spentCount: 0 };

function makeRun() {
  return async (sql) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (text.startsWith("select action_uuid")) return { rowCount: 0, rows: [] };
    if (text.startsWith("select count(*)::int as count")) {
      return { rowCount: 1, rows: [{ count: state.spentCount, quantity: state.spentCount ? 5 : 0 }] };
    }
    if (text.startsWith("select projectid, status, assignedto")) {
      return { rowCount: 1, rows: [{ projectid: PROJECT, status: state.ticketStatus, assignedto: "purchaser-1" }] };
    }
    if (text.startsWith("select status from projects")) return { rowCount: 1, rows: [{ status: "Active" }] };
    if (text.startsWith("update tickets set status = 'resolved'")) {
      state.ticketStatus = "Resolved";
      return { rowCount: 1, rows: [] };
    }
    if (text.startsWith("insert into expenses")) {
      if (state.failInsert) throw new Error("insert failed");
      state.expenses += 1;
      return { rowCount: 1, rows: [{ expenseid: "e-1" }] };
    }
    if (text.startsWith("insert into synced_actions")) {
      state.synced += 1;
      return { rowCount: 1, rows: [] };
    }
    throw new Error("unexpected query: " + text);
  };
}

const run = makeRun();
stub("../src/lib/db", {
  query: run,
  // like a real transaction: a throw puts the tickets row back
  withTransaction: async (fn) => {
    const before = { ticketStatus: state.ticketStatus, expenses: state.expenses, synced: state.synced };
    try {
      return await fn({ query: run });
    } catch (error) {
      Object.assign(state, before);
      throw error;
    }
  },
});
stub("../src/middleware/auth", {
  requireAuth: (req, _res, next) => ((req.user = { id: "purchaser-1", role: "Purchaser" }), next()),
});
stub("../src/lib/receiptStorage", { receiptImageExists: async () => true });
stub("../src/lib/screenExpense", { screenExpense: async () => ({ flagTypes: [] }) });
const syncRouter = require("../src/routes/sync");

const expenseItem = () => ({
  uuid: UUID,
  type: "expense",
  data: {
    ticketID: TICKET,
    vendorName: "Cebu Builders",
    amount: 1500,
    receiptDate: "2026-10-10",
    category: "Materials",
    receiptImageURL: "http://x/receipts/files/a.jpg",
    lineItems: [{ description: "Cement", quantity: 3, amount: 1500 }],
  },
});

async function sync(items) {
  const app = express();
  app.use(express.json());
  app.use("/api/sync", syncRouter);
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test("a good expense resolves its ticket and is saved", async () => {
  Object.assign(state, { ticketStatus: "Acknowledged", failInsert: false, expenses: 0, synced: 0 });
  const res = await sync([expenseItem()]);
  assert.deepEqual(res.body, { syncedIds: [UUID], rejected: [] });
  assert.equal(state.ticketStatus, "Resolved");
  assert.equal(state.expenses, 1);
});

test("a failed expense insert leaves the ticket as it was (not Resolved)", async () => {
  Object.assign(state, { ticketStatus: "Acknowledged", failInsert: true, expenses: 0, synced: 0 });
  const res = await sync([expenseItem()]);
  assert.equal(res.body.syncedIds.length, 0);
  assert.equal(res.body.rejected[0].code, "SERVER_ERROR");
  assert.equal(state.ticketStatus, "Acknowledged");
  assert.equal(state.expenses, 0);
});

test("a request that is already fulfilled rejects the queued expense", async () => {
  Object.assign(state, { ticketStatus: "Resolved", failInsert: false, expenses: 0, synced: 0, spentCount: 1 });
  const res = await sync([expenseItem()]);
  state.spentCount = 0;
  assert.equal(res.body.syncedIds.length, 0);
  assert.equal(res.body.rejected[0].code, "TICKET_FULFILLED");
  assert.equal(state.expenses, 0);
});

test("a Rejected or Pending ticket rejects the queued expense", async () => {
  for (const ticketStatus of ["Rejected", "Pending"]) {
    Object.assign(state, { ticketStatus, failInsert: false, expenses: 0, synced: 0, spentCount: 0 });
    const res = await sync([expenseItem()]);
    assert.equal(res.body.rejected[0].code, "TICKET_NOT_OPEN");
    assert.equal(state.expenses, 0);
  }
});
