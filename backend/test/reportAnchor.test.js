// F11 report anchoring (reportAnchor.js). No database and no Geth: the
// queries and the chain call are fakes, so every Pending/Confirmed path runs.
const test = require("node:test");
const assert = require("node:assert/strict");
const { anchorReport } = require("../src/lib/reportAnchor");
const { canonicalizeReport } = require("../src/lib/blockchainService");

const P1 = "11111111-1111-4111-8111-111111111111";
const REPORT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };

function storedRow(overrides = {}) {
  const row = {
    reportid: REPORT_ID,
    generatedby: ACTOR.id,
    projectids: [P1],
    periodfrom: "2026-10-01",
    periodto: "2026-10-31",
    generatedat: new Date("2026-10-16T01:00:00.000Z"),
    totals: { projects: [{ projectId: P1, budget: 50000, periodSpend: 15000, cumulativeSpend: 15000, birDeductibleSpend: 5000 }] },
    anchorstatus: "Pending",
  };
  row.payloadhash = canonicalizeReport(row);
  return { ...row, ...overrides };
}

// A tiny in-memory stand-in for the two tables involved.
function makeDb(row, { insertError } = {}) {
  const db = { row, logs: [], updates: 0, chainCalls: 0 };
  const run = async (sql, params) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (text.startsWith("select * from report_events")) return { rows: db.row ? [db.row] : [] };
    if (text.startsWith("select txhash")) return { rows: db.logs.map((l) => ({ txhash: l.txhash, blocknumber: l.blocknumber, validatornodecount: l.validatornodecount })) };
    if (text.startsWith("insert into blockchainlogs")) {
      if (insertError) throw insertError;
      const [reportid, actorid, txhash, blocknumber, validatornodecount] = params;
      assert.match(text, /'reportgenerated'/);
      assert.doesNotMatch(text, /expenseid/); // report rows never set an expense
      db.logs.push({ reportid, actorid, txhash, blocknumber, validatornodecount });
      return { rows: [] };
    }
    if (text.startsWith("update report_events set anchorstatus = 'confirmed'")) {
      db.updates += 1;
      db.row = { ...db.row, anchorstatus: "Confirmed" };
      return { rows: [] };
    }
    throw new Error("unexpected query: " + text);
  };
  db.deps = (submitHash) => ({
    query: run,
    // all-or-nothing, like a real transaction
    withTransaction: async (fn) => {
      const before = { logs: [...db.logs], row: db.row, updates: db.updates };
      try {
        return await fn({ query: run });
      } catch (error) {
        Object.assign(db, before);
        throw error;
      }
    },
    submitHash: async (hash) => {
      db.chainCalls += 1;
      return submitHash(hash);
    },
  });
  return db;
}

const goodChain = async () => ({ txHash: "0xabc", blockNumber: 42, validatorNodeCount: 3 });

test("success: one ReportGenerated log row with the report id, status becomes Confirmed", async () => {
  const db = makeDb(storedRow());
  const result = await anchorReport(REPORT_ID, ACTOR, db.deps(goodChain));
  assert.deepEqual(result, { status: "Confirmed", txHash: "0xabc", blockNumber: 42, validatorNodeCount: 3 });
  assert.equal(db.logs.length, 1);
  assert.equal(db.logs[0].reportid, REPORT_ID);
  assert.equal(db.logs[0].actorid, ACTOR.id);
  assert.equal(db.row.anchorstatus, "Confirmed");
});

test("the hash sent to the chain is the stored payloadhash", async () => {
  const row = storedRow();
  const db = makeDb(row);
  let sentHash;
  await anchorReport(REPORT_ID, ACTOR, db.deps(async (hash) => ((sentHash = hash), goodChain())));
  assert.equal(sentHash, row.payloadhash);
});

test("chain down or timeout: stays Pending, writes nothing, does not throw", async () => {
  const db = makeDb(storedRow());
  const result = await anchorReport(REPORT_ID, ACTOR, db.deps(async () => { throw new Error("TIMEOUT"); }));
  assert.equal(result.status, "Pending");
  assert.match(result.error, /TIMEOUT/);
  assert.equal(db.logs.length, 0);
  assert.equal(db.row.anchorstatus, "Pending");
});

test("fewer than 2 validator nodes: stays Pending", async () => {
  const db = makeDb(storedRow());
  const result = await anchorReport(REPORT_ID, ACTOR, db.deps(async () => ({ txHash: "0x1", blockNumber: 1, validatorNodeCount: 1 })));
  assert.equal(result.status, "Pending");
  assert.match(result.error, /2 of 3/);
  assert.equal(db.logs.length, 0);
});

test("retry after a failure gives Confirmed (the R7 checkpoint, with a fake chain)", async () => {
  const db = makeDb(storedRow());
  let up = false;
  const flaky = async () => {
    if (!up) throw new Error("no validators");
    return goodChain();
  };
  assert.equal((await anchorReport(REPORT_ID, ACTOR, db.deps(flaky))).status, "Pending");
  up = true;
  assert.equal((await anchorReport(REPORT_ID, ACTOR, db.deps(flaky))).status, "Confirmed");
  assert.equal(db.logs.length, 1);
});

test("an already Confirmed report is not sent to the chain again", async () => {
  const db = makeDb(storedRow({ anchorstatus: "Confirmed" }));
  db.logs.push({ reportid: REPORT_ID, txhash: "0xold", blocknumber: 7, validatornodecount: 3 });
  const result = await anchorReport(REPORT_ID, ACTOR, db.deps(goodChain));
  assert.equal(result.status, "Confirmed");
  assert.equal(result.txHash, "0xold");
  assert.equal(db.chainCalls, 0);
  assert.equal(db.logs.length, 1);
});

test("unknown report id gives 404", async () => {
  const db = makeDb(null);
  await assert.rejects(() => anchorReport(REPORT_ID, ACTOR, db.deps(goodChain)), (e) => e.status === 404);
});

test("stored content that no longer matches its hash gives 409 and never reaches the chain", async () => {
  const row = storedRow();
  row.totals.projects[0].periodSpend += 0.01; // someone edited the stored totals
  const db = makeDb(row);
  await assert.rejects(() => anchorReport(REPORT_ID, ACTOR, db.deps(goodChain)), (e) => e.status === 409);
  assert.equal(db.chainCalls, 0);
});

test("two anchors at once: the loser sees the unique-index error and reports Confirmed", async () => {
  const db = makeDb(storedRow(), { insertError: Object.assign(new Error("duplicate key"), { code: "23505" }) });
  db.logs.push({ reportid: REPORT_ID, txhash: "0xwinner", blocknumber: 9, validatornodecount: 3 });
  const result = await anchorReport(REPORT_ID, ACTOR, db.deps(goodChain));
  assert.equal(result.status, "Confirmed");
  assert.equal(result.txHash, "0xwinner");
});

test("a database failure other than the duplicate is not hidden", async () => {
  const db = makeDb(storedRow(), { insertError: Object.assign(new Error("connection lost"), { code: "08006" }) });
  await assert.rejects(() => anchorReport(REPORT_ID, ACTOR, db.deps(goodChain)), /connection lost/);
  assert.equal(db.row.anchorstatus, "Pending");
});

test("a duplicate key with NO log row for this report (e.g. same txHash) is an error, not Confirmed", async () => {
  const db = makeDb(storedRow(), { insertError: Object.assign(new Error("duplicate key: txhash"), { code: "23505" }) });
  await assert.rejects(() => anchorReport(REPORT_ID, ACTOR, db.deps(goodChain)), /duplicate key/);
  assert.equal(db.row.anchorstatus, "Pending");
});
