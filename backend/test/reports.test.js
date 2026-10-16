// F11 report route tests (routes/reports.js). The route runs for real; the
// database and auth are replaced, same approach as adminUsers.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const state = { me: { id: "u1", name: "Test GM", role: "General Manager" }, knownProjects: [P1, P2], calls: [], inserts: [] };

async function fakeQuery(sql, params = []) {
  const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  state.calls.push(text);
  if (text.startsWith("insert into report_events")) {
    state.inserts.push(params);
    return { rows: [], rowCount: 1 };
  }
  if (text.includes("from projects")) {
    const rows = params[0]
      .filter((id) => state.knownProjects.includes(id))
      .map((id) => ({ projectId: id, name: `Project ${id.slice(0, 2)}`, budget: "50000.00" }));
    return { rows };
  }
  if (text.includes("from fraudflags") || text.includes("fraudflags f")) return { rows: [] };
  if (text.includes("from expenses") && text.includes("status = 'approved'")) {
    return {
      rows: [
        { projectId: P1, amount: "5000.00", receiptDate: "2026-10-05", birValidationStatus: "Formal-Tax-Deductible" },
        { projectId: P1, amount: "7000.00", receiptDate: "2026-10-06", birValidationStatus: "Informal" },
        { projectId: P1, amount: "3000.00", receiptDate: "2026-10-07", birValidationStatus: "Informal" },
      ],
    };
  }
  return { rows: [] };
}

stub("../src/lib/db", { query: fakeQuery });
stub("../src/middleware/auth", {
  requireAuth: (req, _res, next) => {
    req.user = state.me;
    next();
  },
});
const reportsRouter = require("../src/routes/reports");

async function get(url) {
  const app = express();
  app.use(express.json({ limit: "5mb" })); // server.js raises the limit for /pdf the same way
  app.use("/api/reports", reportsRouter);
  // same shape as the handler at the bottom of server.js
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, details: err.details }));
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    server.close();
  }
}

async function post(url, body) {
  const app = express();
  app.use(express.json({ limit: "5mb" })); // server.js raises the limit for /pdf the same way
  app.use("/api/reports", reportsRouter);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message, details: err.details }));
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    let json = {};
    try { json = JSON.parse(buffer.toString("utf8")); } catch { /* binary body */ }
    return { status: res.status, headers: res.headers, buffer, body: json };
  } finally {
    server.close();
  }
}

// 1x1 transparent PNG.
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PDF_BODY = { projectIds: [P1], from: "2026-10-01", to: "2026-10-31", chartImage: TINY_PNG };

const OK = `/api/reports/summary?projectIds=${P1}&from=2026-10-01&to=2026-10-31`;

test("Project Manager, Site Manager and Purchaser all get 403; General Manager gets 200", async () => {
  for (const role of ["Project Manager", "Site Manager", "Purchaser"]) {
    state.me = { id: "u2", role };
    assert.equal((await get(OK)).status, 403, role);
  }
  state.me = { id: "u1", role: "General Manager" };
  assert.equal((await get(OK)).status, 200);
});

test("summary returns the computed figures", async () => {
  const res = await get(OK);
  const [row] = res.body.projects;
  assert.equal(row.periodSpend, 15000);
  assert.equal(row.birDeductibleSpend, 5000);
  assert.equal(row.netPnL, 35000);
  assert.equal(row.utilizationPct, 30);
  assert.equal(res.body.empty, false);
  assert.ok(res.body.generatedAt);
});

test("from after to gives 400", async () => {
  const res = await get(`/api/reports/summary?projectIds=${P1}&from=2026-11-01&to=2026-10-01`);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /on or before/);
});

test("a range longer than 366 days gives 400; exactly 366 is fine", async () => {
  const tooLong = await get(`/api/reports/summary?projectIds=${P1}&from=2025-01-01&to=2026-01-02`);
  assert.equal(tooLong.status, 400);
  const leapYear = await get(`/api/reports/summary?projectIds=${P1}&from=2024-01-01&to=2024-12-31`);
  assert.equal(leapYear.status, 200);
});

test("more than 5 projects, or none, gives 400", async () => {
  const ids = Array.from({ length: 6 }, (_, i) => `${i}1111111-1111-4111-8111-111111111111`).join(",");
  assert.equal((await get(`/api/reports/summary?projectIds=${ids}&from=2026-10-01&to=2026-10-31`)).status, 400);
  assert.equal((await get("/api/reports/summary?from=2026-10-01&to=2026-10-31")).status, 400);
});

test("unknown project id gives 400", async () => {
  const unknown = "99999999-9999-4999-8999-999999999999";
  const res = await get(`/api/reports/summary?projectIds=${P1},${unknown}&from=2026-10-01&to=2026-10-31`);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Unknown project id/);
});

test("bad ids and impossible dates give 400, not a database error", async () => {
  assert.equal((await get("/api/reports/summary?projectIds=abc&from=2026-10-01&to=2026-10-31")).status, 400);
  assert.equal((await get(`/api/reports/summary?projectIds=${P1}&from=2026-02-30&to=2026-03-31`)).status, 400);
  assert.equal((await get(`/api/reports/summary?projectIds=${P1}&from=2026-10-01`)).status, 400);
});

test("duplicate ids are collapsed (project counted once)", async () => {
  const res = await get(`/api/reports/summary?projectIds=${P1},${P1}&from=2026-10-01&to=2026-10-31`);
  assert.equal(res.status, 200);
  assert.equal(res.body.projects.length, 1);
});

// ---- POST /pdf ---------------------------------------------------------------

test("PDF: General Manager gets a real PDF attachment and one Pending report_events row", async () => {
  state.me = { id: "u1", name: "Test GM", role: "General Manager" };
  state.inserts.length = 0;
  const res = await post("/api/reports/pdf", PDF_BODY);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.match(res.headers.get("content-disposition"), /^attachment; filename="brickxbrick-report-2026-10-01-to-2026-10-31\.pdf"$/);
  assert.equal(res.buffer.subarray(0, 5).toString(), "%PDF-");
  assert.equal(state.inserts.length, 1);
  const [reportId, generatedBy, projectIds, from, to, , totals, hash] = state.inserts[0];
  assert.equal(res.headers.get("x-report-id"), reportId);
  assert.equal(generatedBy, "u1");
  assert.deepEqual(projectIds, [P1]);
  assert.equal(from, "2026-10-01");
  assert.equal(to, "2026-10-31");
  assert.equal(JSON.parse(totals).projects[0].periodSpend, 15000); // the server's own numbers
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test("PDF: Project Manager, Site Manager and Purchaser get 403", async () => {
  for (const role of ["Project Manager", "Site Manager", "Purchaser"]) {
    state.me = { id: "u2", role };
    assert.equal((await post("/api/reports/pdf", PDF_BODY)).status, 403, role);
  }
  state.me = { id: "u1", name: "Test GM", role: "General Manager" };
});

test("PDF: bad chartImage gives 400 and saves nothing", async () => {
  state.inserts.length = 0;
  const cases = [
    undefined,
    "",
    "data:image/jpeg;base64,/9j/4AAQ",
    "https://example.com/chart.png",
    "data:image/png;base64,!!!notbase64!!!",
    "data:image/png;base64," + Buffer.from("this is not a png at all").toString("base64"),
    "data:image/png;base64," + "A".repeat(1_500_100), // oversized
  ];
  for (const chartImage of cases) {
    const res = await post("/api/reports/pdf", { ...PDF_BODY, chartImage });
    assert.equal(res.status, 400, String(chartImage).slice(0, 40));
  }
  assert.equal(state.inserts.length, 0);
});

test("PDF: filters are validated like the summary route", async () => {
  assert.equal((await post("/api/reports/pdf", { ...PDF_BODY, from: "2026-11-01" })).status, 400);
  assert.equal((await post("/api/reports/pdf", { ...PDF_BODY, projectIds: [] })).status, 400);
});

test("PHP formatting: thousands separators, 2 decimals, negatives, no peso glyph", () => {
  const { formatPhp } = require("../src/lib/reportPdf");
  assert.equal(formatPhp(12345), "PHP 12,345.00");
  assert.equal(formatPhp(37000.5), "PHP 37,000.50");
  assert.equal(formatPhp(0), "PHP 0.00");
  assert.equal(formatPhp(-7500), "-PHP 7,500.00");
  assert.equal(formatPhp(1234567.891), "PHP 1,234,567.89");
});
