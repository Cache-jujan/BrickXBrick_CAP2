// Post-consultation fix (Nov 2026): only the Project Manager gives a budget.
//
//   - A Site Manager's Material Request no longer needs a requested budget.
//   - A Site Manager does not choose a vendor.
//   - A budget or vendor sent by a Site Manager anyway (older app version, or a
//     request queued offline before the update) is ignored, not rejected, so it
//     still syncs. Nothing is saved for either.
//   - The PM still sets the approved budget and the vendor.
//   - The PM's edit of a pending ticket no longer touches requestedBudget.
//
// The routes run for real; the database and auth are replaced.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const PROJECT = "11111111-1111-4111-8111-111111111111"; // project-alpha
const SM = { id: "sm-alpha", role: "Site Manager", name: "Sam Site" };
const PM = { id: "pm-1", role: "Project Manager", name: "Test PM" };
const PURCHASER = "22222222-2222-4222-8222-222222222222"; // purchaser-1

const users = {
  [PURCHASER]: { userid: PURCHASER, role: "Purchaser", status: "Active" },
};

const state = { me: SM, inserted: [], updates: [], ticket: null, bought: false, photos: [] };

// Pair the INSERT's column list with its values, so tests read by column name.
function insertedRow(text, params) {
  const columns = text.slice(text.indexOf("(") + 1, text.indexOf(")")).split(",").map((c) => c.trim());
  return Object.fromEntries(columns.map((column, i) => [column, params[i]]));
}

async function fakeQuery(sql, params = []) {
  const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  if (text.startsWith("select projectid, status, sitemanagerid, projectmanagerid from projects")) {
    return { rowCount: 1, rows: [{ projectid: PROJECT, status: "Active", sitemanagerid: SM.id, projectmanagerid: PM.id }] };
  }
  if (text.startsWith("select userid, role, status from users where userid")) {
    const row = users[params[0]];
    return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
  }
  if (text.startsWith("select t.*, p.name as projectname")) {
    return { rowCount: 1, rows: [state.ticket] };
  }
  if (text.startsWith("update tickets set")) {
    state.updates.push({ text, params });
    return { rowCount: 1, rows: [{ ...state.ticket }] };
  }
  return { rowCount: 0, rows: [] };
}

const client = {
  query: async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (text.startsWith("insert into tickets")) {
      const row = insertedRow(text, params);
      state.inserted.push(row);
      return { rowCount: 1, rows: [{ ticketid: `ticket-${state.inserted.length}`, ...row }] };
    }
    if (text.startsWith("insert into ticket_photos")) {
      state.photos.push(params);
      return { rowCount: 1, rows: [] };
    }
    if (text.startsWith("select status from tickets where ticketid")) {
      return { rowCount: 1, rows: [{ status: state.ticket.status }] };
    }
    if (text.startsWith("select 1 from expenses")) {
      return state.bought ? { rowCount: 1, rows: [{ "?column?": 1 }] } : { rowCount: 0, rows: [] };
    }
    if (text.startsWith("update tickets set")) {
      state.updates.push({ text, params });
      return { rowCount: 1, rows: [{ ...state.ticket, status: text.includes("status = 'rejected'") ? "Rejected" : state.ticket.status }] };
    }
    return { rowCount: 0, rows: [] };
  },
};

stub("../src/lib/db", { query: fakeQuery, withTransaction: async (fn) => fn(client) });
stub("../src/middleware/auth", {
  requireAuth: (req, _res, next) => {
    req.user = state.me;
    next();
  },
});
stub("../src/lib/ticketTransitions", { assertLegalTransition: () => {}, logTransition: async () => {} });
stub("../src/lib/notify", { notify: async () => {}, notifyTicketTransition: async () => {} });

const ticketsRouter = require("../src/routes/tickets");

async function call(method, url, body) {
  const app = express();
  app.use(express.json());
  app.use("/api/tickets", ticketsRouter);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    server.close();
  }
}

function reset(me) {
  state.me = me;
  state.inserted.length = 0;
  state.updates.length = 0;
  state.photos.length = 0;
  state.ticket = null;
}

// Not-in-BOM, so no BOM lookup is needed.
const smMaterialRequest = (extra = {}) => ({
  projectID: PROJECT,
  ticketType: "Material Request",
  subject: "Cement for slab",
  quantity: 20,
  unit: "bag",
  materialType: "Cement",
  notInBom: true,
  notInBomReason: "Added scope",
  ...extra,
});

test("Site Manager Material Request without a budget or vendor is accepted as Pending", async () => {
  reset(SM);
  const res = await call("POST", "/api/tickets", smMaterialRequest());
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const row = state.inserted[0];
  assert.equal(row.status, "Pending");
  assert.equal(row.vendorname, null);
  assert.equal(row.approvedbudget, null);
  assert.equal("requestedbudget" in row, false, "requestedBudget is no longer written");
});

test("a budget and vendor sent by a Site Manager anyway are ignored, not rejected", async () => {
  reset(SM);
  const res = await call("POST", "/api/tickets", smMaterialRequest({ requestedBudget: 5000, vendorName: "Cebu Hardware" }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const row = state.inserted[0];
  assert.equal(row.vendorname, null);
  assert.equal("requestedbudget" in row, false);
});

test("a negative budget from an old app version does not block the request", async () => {
  reset(SM);
  const res = await call("POST", "/api/tickets", smMaterialRequest({ requestedBudget: -1 }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
});

test("Site Manager Work Item ignores a vendor too", async () => {
  reset(SM);
  const res = await call("POST", "/api/tickets", {
    projectID: PROJECT,
    ticketType: "Work Item",
    subject: "Mix concrete",
    quantity: 1,
    unit: "lot",
    materialType: "Concrete",
    vendorName: "Cebu Hardware",
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(state.inserted[0].vendorname, null);
});

test("Site Manager batch (mobile form) without budgets is accepted", async () => {
  reset(SM);
  const res = await call("POST", "/api/tickets/batch", { tickets: [smMaterialRequest(), smMaterialRequest({ subject: "Sand" })] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(state.inserted.length, 2);
});

test("Project Manager Material Request still requires an approved budget", async () => {
  reset(PM);
  const res = await call("POST", "/api/tickets", smMaterialRequest({ assignedTo: PURCHASER, vendorName: "Cebu Hardware" }));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /approvedBudget/);
  assert.equal(state.inserted.length, 0);
});

test("Project Manager keeps the vendor and the approved budget", async () => {
  reset(PM);
  const res = await call("POST", "/api/tickets", smMaterialRequest({ assignedTo: PURCHASER, vendorName: " Cebu Hardware ", approvedBudget: 5000 }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const row = state.inserted[0];
  assert.equal(row.status, "Acknowledged");
  assert.equal(row.vendorname, "Cebu Hardware");
  assert.equal(row.approvedbudget, 5000);
});

test("PM editing a pending request sets the vendor and never touches requestedBudget", async () => {
  reset(PM);
  state.ticket = {
    ticketid: "ticket-9",
    tickettype: "Material Request",
    status: "Pending",
    bomitemid: "bom-item-1", // on-BOM: material and unit stay locked
    projectmanagerid: PM.id,
    sitemanagerid: SM.id,
    projectname: "Alpha",
    subject: "Cement for slab",
  };
  const res = await call("PATCH", "/api/tickets/ticket-9", {
    subject: "Cement for slab",
    quantity: 25,
    vendorName: "Cebu Hardware",
    requestedBudget: 9999,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(state.updates.length, 1);
  const { text, params } = state.updates[0];
  assert.equal(text.includes("requestedbudget"), false, "the edit must not write requestedBudget");
  assert.ok(text.includes("vendorname"));
  assert.ok(params.includes("Cebu Hardware"));
  assert.equal(params.includes(9999), false);
});

function ackTicket() {
  state.ticket = {
    ticketid: "ticket-9",
    tickettype: "Material Request",
    status: "Acknowledged",
    bomitemid: "bom-item-1",
    projectmanagerid: PM.id,
    sitemanagerid: SM.id,
    projectid: PROJECT,
    projectname: "Alpha",
    subject: "Cement for slab",
  };
}

test("PM can edit an Acknowledged request while nothing has been bought", async () => {
  reset(PM);
  ackTicket();
  const res = await call("PATCH", "/api/tickets/ticket-9", { subject: "Cement for slab", quantity: 30 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(state.updates.length, 1);
});

test("PM cannot edit or cancel an Acknowledged request that already has a receipt", async () => {
  reset(PM);
  ackTicket();
  state.bought = true;
  const edit = await call("PATCH", "/api/tickets/ticket-9", { subject: "Cement for slab", quantity: 30 });
  assert.equal(edit.status, 409);
  assert.match(edit.body.error, /already has a receipt/);
  const cancel = await call("PATCH", "/api/tickets/ticket-9/reject", { reason: "Not needed" });
  assert.equal(cancel.status, 409);
  assert.equal(state.updates.length, 0);
  state.bought = false;
});

test("PM cancelling an Acknowledged request stores a 'Cancelled by PM:' reason", async () => {
  reset(PM);
  ackTicket();
  const res = await call("PATCH", "/api/tickets/ticket-9/reject", { reason: "Stock found on site" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(state.updates[0].params.includes("Cancelled by PM: Stock found on site"));
});

const PHOTO_BASE = "https://photos.test";
const photo = (n) => `${PHOTO_BASE}/ticket-photos/${n}.jpg`;
const report = (extra = {}) => ({ projectID: PROJECT, ticketType: "Report", subject: "Leak", description: "Water on level 2", ...extra });

test("a Report keeps up to 3 of this server's photos, in order", async () => {
  process.env.R2_PUBLIC_BASE_URL = PHOTO_BASE;
  reset(SM);
  const res = await call("POST", "/api/tickets", report({ photoUrls: [photo("a"), photo("b")] }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(state.photos.map((p) => [p[1], p[2]]), [[photo("a"), 1], [photo("b"), 2]]);
});

test("a Report refuses a fourth photo and links that are not our uploads", async () => {
  process.env.R2_PUBLIC_BASE_URL = PHOTO_BASE;
  reset(SM);
  const four = await call("POST", "/api/tickets", report({ photoUrls: [photo("a"), photo("b"), photo("c"), photo("d")] }));
  assert.equal(four.status, 400);
  const foreign = await call("POST", "/api/tickets", report({ photoUrls: ["https://evil.test/x.jpg"] }));
  assert.equal(foreign.status, 400);
  assert.equal(state.photos.length, 0);
});

test("photos sent with a non-Report ticket are ignored", async () => {
  process.env.R2_PUBLIC_BASE_URL = PHOTO_BASE;
  reset(SM);
  const res = await call("POST", "/api/tickets", smMaterialRequest({ photoUrls: [photo("a")] }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(state.photos.length, 0);
});
