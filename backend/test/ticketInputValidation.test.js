// Typed ticket values are checked on the server: type, trim, length, range, id shape.
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

const state = { me: SM, inserted: [], updates: [], ticket: null };

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
  state.ticket = null;
}


const request = (extra = {}) => ({
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

async function refused(extra, pattern) {
  reset(SM);
  const res = await call("POST", "/api/tickets", request(extra));
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error, pattern);
  assert.equal(state.inserted.length, 0, "nothing is saved");
}

test("a valid request is saved with trimmed text", async () => {
  reset(SM);
  const res = await call("POST", "/api/tickets", request({ subject: "  Cement for slab  ", description: " near gate " }));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(state.inserted[0].subject, "Cement for slab");
  assert.equal(state.inserted[0].description, "near gate");
});

test("a subject that is only spaces is refused", () => refused({ subject: "     " }, /required/i));
test("a subject that is not text is refused", () => refused({ subject: ["a", "b"] }, /Subject must be text/));
test("a subject over 100 characters is refused with its limit", () => refused({ subject: "x".repeat(101) }, /Subject must be 100 characters or fewer/));
test("a 100,000 character description is refused", () => refused({ description: "x".repeat(100000) }, /Description must be 2000 characters or fewer/));
test("a material over 100 characters is refused", () => refused({ materialType: "m".repeat(101) }, /Material must be 100 characters or fewer/));
test("a unit over 30 characters is refused", () => refused({ unit: "u".repeat(31) }, /Unit must be 30 characters or fewer/));
test("a quantity beyond the column is refused, not a server error", () => refused({ quantity: 1e12 }, /Quantity must not be more than/));
test("a quantity of 0 or less is refused", () => refused({ quantity: 0 }, /Quantity must be more than 0/));
test("a project id that is not an id is refused", () => refused({ projectID: "not-an-id" }, /Project is not a valid id/));
