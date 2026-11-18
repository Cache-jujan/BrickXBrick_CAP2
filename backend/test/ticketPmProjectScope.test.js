// A Project Manager may only resolve or reject tickets from projects assigned
// to them, the same rule /acknowledge and PATCH /:id already apply.
// The routes run for real; the database and auth are replaced.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const PROJECT = "11111111-1111-4111-8111-111111111111";
const TICKET = "33333333-3333-4333-8333-333333333333";
const OWN_PM = { id: "pm-1", role: "Project Manager", name: "Own PM" };
const OTHER_PM = { id: "pm-2", role: "Project Manager", name: "Other PM" };

const state = { me: OWN_PM, ticket: null, updates: 0 };

async function fakeQuery(sql) {
  const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  if (text.startsWith("select projectid, status, sitemanagerid, projectmanagerid from projects")) {
    return { rowCount: 1, rows: [{ projectid: PROJECT, status: "Active", sitemanagerid: "sm-1", projectmanagerid: "pm-1" }] };
  }
  if (text.startsWith("select t.*, p.name as projectname")) return { rowCount: 1, rows: [state.ticket] };
  return { rowCount: 0, rows: [] };
}
const client = {
  query: async (sql) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (text.startsWith("update tickets")) {
      state.updates += 1;
      return { rowCount: 1, rows: [{ ...state.ticket, status: "Resolved" }] };
    }
    return { rowCount: 0, rows: [] };
  },
};

stub("../src/lib/db", { query: fakeQuery, withTransaction: async (fn) => fn(client) });
stub("../src/middleware/auth", { requireAuth: (req, _res, next) => { req.user = state.me; next(); } });
stub("../src/lib/ticketTransitions", { assertLegalTransition: () => {}, logTransition: async () => {} });
stub("../src/lib/notify", { notify: async () => {}, notifyTicketTransition: async () => {} });

const ticketsRouter = require("../src/routes/tickets");

async function call(method, url, body) {
  const app = express();
  app.use(express.json());
  app.use("/api/tickets", ticketsRouter);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
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

function setup(me, ticketType) {
  state.me = me;
  state.updates = 0;
  state.ticket = {
    ticketid: TICKET, projectid: PROJECT, tickettype: ticketType, status: "Pending",
    projectmanagerid: "pm-1", sitemanagerid: "sm-1", assignedto: null, projectname: "Alpha",
  };
}

test("a PM of another project cannot resolve a Report ticket", async () => {
  setup(OTHER_PM, "Report");
  const res = await call("PATCH", `/api/tickets/${TICKET}/resolve`);
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(state.updates, 0, "nothing may be written");
});

test("the project's own PM can still resolve a Report ticket", async () => {
  setup(OWN_PM, "Report");
  const res = await call("PATCH", `/api/tickets/${TICKET}/resolve`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(state.updates, 1);
});

test("a PM of another project cannot reject a Pending ticket", async () => {
  setup(OTHER_PM, "Material Request");
  const res = await call("PATCH", `/api/tickets/${TICKET}/reject`, { reason: "No" });
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(state.updates, 0, "nothing may be written");
});

test("the project's own PM can still reject a Pending ticket with a reason", async () => {
  setup(OWN_PM, "Material Request");
  const res = await call("PATCH", `/api/tickets/${TICKET}/reject`, { reason: "Not needed" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(state.updates, 1);
});
