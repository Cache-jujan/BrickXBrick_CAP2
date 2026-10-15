// F2 — recording the client's agreement when the BOM is approved (adviser item 5).
// The agreement happens outside the system; approving the BOM must record when
// and with whom, and purchases only start after the project is activated.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { validateClientAgreement, manilaToday } = require("../src/lib/bomRules");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const TODAY = "2026-10-16";
const ok = { clientAgreedOn: "2026-10-03", clientAgreedBy: "Maria Santos", agreementRef: "Contract #2026-014" };

test("a complete agreement is accepted and tidied", () => {
  const r = validateClientAgreement({ ...ok, clientAgreedBy: "  Maria   Santos ", agreementRef: "  " }, TODAY);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.value, { clientAgreedOn: "2026-10-03", clientAgreedBy: "Maria Santos", agreementRef: null });
});

test("the date and the name are required", () => {
  const r = validateClientAgreement({}, TODAY);
  assert.deepEqual(r.errors.map((e) => e.field), ["clientAgreedOn", "clientAgreedBy"]);
});

test("a future date, an impossible date and a one-letter name are refused", () => {
  assert.equal(validateClientAgreement({ ...ok, clientAgreedOn: "2026-10-17" }, TODAY).errors[0].field, "clientAgreedOn");
  assert.equal(validateClientAgreement({ ...ok, clientAgreedOn: "2026-02-30" }, TODAY).errors[0].field, "clientAgreedOn");
  assert.equal(validateClientAgreement({ ...ok, clientAgreedOn: "03/10/2026" }, TODAY).errors[0].field, "clientAgreedOn");
  assert.equal(validateClientAgreement({ ...ok, clientAgreedBy: "M" }, TODAY).errors[0].field, "clientAgreedBy");
});

test("today counts as a valid agreement date; the reference has a length limit", () => {
  assert.deepEqual(validateClientAgreement({ ...ok, clientAgreedOn: TODAY }, TODAY).errors, []);
  assert.equal(validateClientAgreement({ ...ok, agreementRef: "x".repeat(101) }, TODAY).errors[0].field, "agreementRef");
});

test("'today' is the date in the Philippines, not the server's", () => {
  // 2026-10-16 17:30 UTC is already Oct 17 in Manila
  assert.equal(manilaToday(new Date("2026-10-16T17:30:00Z")), "2026-10-17");
  assert.equal(manilaToday(new Date("2026-10-16T15:30:00Z")), "2026-10-16");
});

// ---- route: approval without the agreement never reaches the database -------
const touched = [];
stub("../src/lib/db", {
  query: async (sql) => {
    touched.push(sql);
    return { rowCount: 0, rows: [] };
  },
  withTransaction: async (fn) =>
    fn({
      query: async (sql) => {
        touched.push(sql);
        return { rowCount: 0, rows: [] };
      },
    }),
});
stub("../src/middleware/auth", {
  requireAuth: (req, _res, next) => {
    req.user = { id: "gm-1", role: "General Manager" };
    next();
  },
});
const bomRouter = require("../src/routes/bom");

async function approve(body) {
  const app = express();
  app.use(express.json());
  app.use("/api/projects/:projectId/bom", bomRouter);
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/projects/11111111-1111-4111-8111-111111111111/bom/approve`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test("approving without the agreement details is refused with the field named", async () => {
  touched.length = 0;
  const res = await approve({ confirmWarnings: true });
  assert.equal(res.status, 400);
  assert.equal(res.body.errors[0].field, "clientAgreedOn");
  assert.equal(touched.length, 0, "nothing was read or written");
});

test("approving with a future agreement date is refused", async () => {
  const res = await approve({ ...ok, clientAgreedOn: "2999-01-01" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /future/);
});

test("the BOM routes store the agreement on approve and clear it on reopen (static check)", () => {
  const src = require("node:fs").readFileSync(require.resolve("../src/routes/bom.js"), "utf8");
  assert.match(src, /clientagreedon = \$3::date, clientagreedby = \$4, agreementref = \$5/);
  assert.match(src, /clientagreedon = NULL, clientagreedby = NULL, agreementref = NULL/);
});
