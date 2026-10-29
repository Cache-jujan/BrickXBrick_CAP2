// A Project Manager creating a purchase ticket can hand it to the project's own
// Site Manager to buy, instead of waiting for the Site Manager to request it.
//
//   - POST /api/tickets: the assignee may be a Purchaser (as before) or the Site
//     Manager of THAT project, for a Material Request or a Work Item.
//   - The assigned Site Manager can resolve or reject the ticket, like a Purchaser.
//   - GET /api/tickets/purchasers?projectID=: lists the Purchasers, plus that
//     project's active Site Manager at the end when the PM manages the project.
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

const PM = { id: "pm-1", role: "Project Manager", name: "Test PM" };
const PROJECT = "project-alpha";
const SM_HERE = "sm-alpha"; // the Site Manager of project-alpha
const SM_ELSEWHERE = "sm-beta"; // a Site Manager of some other project
const PURCHASER = "purchaser-1";
const GM = "gm-1";

const users = {
  [SM_HERE]: { userid: SM_HERE, role: "Site Manager", status: "Active" },
  [SM_ELSEWHERE]: { userid: SM_ELSEWHERE, role: "Site Manager", status: "Active" },
  [PURCHASER]: { userid: PURCHASER, role: "Purchaser", status: "Active" },
  [GM]: { userid: GM, role: "General Manager", status: "Active" },
};

const state = {
  calls: [],
  inserted: [],
  updated: [],
  projectManagerId: PM.id,
  me: PM,
  // The ticket GET-by-id returns: assigned to SM_HERE, on a project whose Site Manager is SM_HERE.
  ticket: null,
};

async function fakeQuery(sql, params = []) {
  const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  state.calls.push({ text, params });
  if (text.startsWith("select projectid, status, sitemanagerid, projectmanagerid from projects")) {
    return { rowCount: 1, rows: [{ projectid: PROJECT, status: "Active", sitemanagerid: SM_HERE, projectmanagerid: state.projectManagerId }] };
  }
  if (text.startsWith("select t.*, p.name as projectname")) {
    return { rowCount: 1, rows: [state.ticket] };
  }
  if (text.startsWith("select userid, role, status from users where userid")) {
    const row = users[params[0]];
    return row ? { rowCount: 1, rows: [row] } : { rowCount: 0, rows: [] };
  }
  if (text.includes("from users where role = 'purchaser'")) {
    return { rowCount: 1, rows: [{ userid: PURCHASER, name: "Pat Purchaser", email: "pat@example.com", role: "Purchaser" }] };
  }
  if (text.includes("from projects p join users u")) {
    // Only the PM who manages the project gets its Site Manager back.
    const [projectId, pmId] = params;
    const managed = projectId === PROJECT && pmId === state.projectManagerId;
    return managed
      ? { rowCount: 1, rows: [{ userid: SM_HERE, name: "Sam Site", email: "sam@example.com", role: "Site Manager" }] }
      : { rowCount: 0, rows: [] };
  }
  return { rowCount: 0, rows: [] };
}

const client = {
  query: async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (text.startsWith("insert into tickets")) {
      state.inserted.push(params);
      return { rowCount: 1, rows: [{ ticketid: "ticket-1", subject: params[3], status: params[14], assignedto: params[15] }] };
    }
    if (text.startsWith("update tickets")) {
      state.updated.push(params);
      return { rowCount: 1, rows: [{ ticketid: params[1], status: text.includes("'rejected'") ? "Rejected" : "Resolved" }] };
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

function reset() {
  state.calls.length = 0;
  state.inserted.length = 0;
  state.updated.length = 0;
  state.projectManagerId = PM.id;
  state.me = PM;
  state.ticket = {
    ticketid: "ticket-9",
    tickettype: "Work Item",
    status: "Acknowledged",
    assignedto: SM_HERE,
    sitemanagerid: SM_HERE,
    projectmanagerid: PM.id,
    projectname: "Alpha",
    subject: "Mix concrete",
  };
}

// A Material Request that is not in the BOM (so no BOM lookup is needed).
const materialRequest = (assignedTo) => ({
  projectID: PROJECT,
  ticketType: "Material Request",
  subject: "Cement for slab",
  quantity: 20,
  unit: "bag",
  materialType: "Cement",
  vendorName: "Cebu Hardware",
  notInBom: true,
  notInBomReason: "Added scope",
  approvedBudget: 5000,
  assignedTo,
});

const workItem = (assignedTo) => ({
  projectID: PROJECT,
  ticketType: "Work Item",
  subject: "Mix concrete",
  quantity: 1,
  unit: "lot",
  materialType: "Concrete",
  vendorName: "Cebu Hardware",
  assignedTo,
});

test("PM can assign a Material Request to the project's Site Manager: created Acknowledged with them as assignee", async () => {
  reset();
  const res = await call("POST", "/api/tickets", materialRequest(SM_HERE));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(state.inserted.length, 1);
  const params = state.inserted[0];
  assert.equal(params[14], "Acknowledged");
  assert.equal(params[15], SM_HERE);
});

test("PM can still assign a Material Request to a Purchaser", async () => {
  reset();
  const res = await call("POST", "/api/tickets", materialRequest(PURCHASER));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(state.inserted[0][15], PURCHASER);
});

test("PM can still assign a Work Item to a Purchaser", async () => {
  reset();
  const res = await call("POST", "/api/tickets", workItem(PURCHASER));
  assert.equal(res.status, 201, JSON.stringify(res.body));
});

test("a Site Manager of another project cannot be assigned", async () => {
  reset();
  const res = await call("POST", "/api/tickets", materialRequest(SM_ELSEWHERE));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /project they are assigned to/);
  assert.equal(state.inserted.length, 0);
});

test("PM can assign a Work Item to the project's Site Manager too", async () => {
  reset();
  const res = await call("POST", "/api/tickets", workItem(SM_HERE));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(state.inserted[0][14], "Acknowledged");
  assert.equal(state.inserted[0][15], SM_HERE);
});

test("the assigned Site Manager can resolve the ticket", async () => {
  reset();
  state.me = { id: SM_HERE, role: "Site Manager", name: "Sam Site" };
  const res = await call("PATCH", "/api/tickets/ticket-9/resolve");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(state.updated.length, 1);
  assert.equal(state.updated[0][0], SM_HERE, "resolvedBy is the Site Manager");
});

test("a Site Manager the ticket is not assigned to cannot resolve it", async () => {
  reset();
  state.me = { id: SM_ELSEWHERE, role: "Site Manager", name: "Other SM" };
  const res = await call("PATCH", "/api/tickets/ticket-9/resolve");
  assert.equal(res.status, 403);
  assert.equal(state.updated.length, 0);
});

test("an assigned Site Manager who has since been moved off the project cannot resolve it", async () => {
  reset();
  state.me = { id: SM_HERE, role: "Site Manager", name: "Sam Site" };
  state.ticket.sitemanagerid = SM_ELSEWHERE;
  const res = await call("PATCH", "/api/tickets/ticket-9/resolve");
  assert.equal(res.status, 403);
  assert.match(res.body.error, /no longer the Site Manager/);
  assert.equal(state.updated.length, 0);
});

test("the assigned Site Manager can reject an Acknowledged ticket", async () => {
  reset();
  state.me = { id: SM_HERE, role: "Site Manager", name: "Sam Site" };
  const res = await call("PATCH", "/api/tickets/ticket-9/reject", { reason: "Out of stock" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(state.updated.length, 1);
});

test("a Site Manager cannot resolve a Report ticket", async () => {
  reset();
  state.me = { id: SM_HERE, role: "Site Manager", name: "Sam Site" };
  state.ticket.tickettype = "Report";
  state.ticket.status = "Pending";
  const res = await call("PATCH", "/api/tickets/ticket-9/resolve");
  assert.equal(res.status, 403);
  assert.equal(state.updated.length, 0);
});

test("other roles still cannot be assigned", async () => {
  reset();
  const res = await call("POST", "/api/tickets", materialRequest(GM));
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Purchaser or this project's Site Manager/);
  assert.equal(state.inserted.length, 0);
});

test("GET /purchasers without a project lists only Purchasers", async () => {
  reset();
  const res = await call("GET", "/api/tickets/purchasers");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((p) => p.role), ["Purchaser"]);
  assert.ok(!state.calls.some((c) => c.text.includes("from projects p join users u")), "no Site Manager lookup without a project");
});

test("GET /purchasers?projectID= adds the project's Site Manager after the Purchasers", async () => {
  reset();
  const res = await call("GET", `/api/tickets/purchasers?projectID=${PROJECT}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((p) => [p.userid, p.role]), [[PURCHASER, "Purchaser"], [SM_HERE, "Site Manager"]]);
  const lookup = state.calls.find((c) => c.text.includes("from projects p join users u"));
  assert.deepEqual(lookup.params, [PROJECT, PM.id], "scoped to the calling PM's own project");
});

test("GET /purchasers?projectID= for a project the PM does not manage adds no Site Manager", async () => {
  reset();
  state.projectManagerId = "someone-else";
  const res = await call("GET", `/api/tickets/purchasers?projectID=${PROJECT}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((p) => p.role), ["Purchaser"]);
});