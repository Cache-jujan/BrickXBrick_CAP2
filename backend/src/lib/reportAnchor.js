// reportAnchor.js — F11: secure a report's hash on the blockchain.
//
// A report starts as report_events.anchorStatus = 'Pending'. anchorReport()
// sends the stored hash to the chain and, only on success, INSERTs the
// BlockchainLogs row (eventType 'ReportGenerated', reportId set, expenseId
// null) and flips the report to 'Confirmed'. BlockchainLogs is append-only
// (migration 029), so a retry never edits a log row; status lives on
// report_events.
//
// It never throws for a chain problem (nodes down, timeout, fewer than 2 of 3
// validators): the report just stays Pending and can be retried. It throws
// only for "not found" (404) and "stored content no longer matches its hash"
// (409).

const db = require("./db");
const chain = require("./blockchainService");

const MIN_VALIDATORS = 2; // manuscript: at least 2 of 3 nodes must confirm

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * anchorReport(reportId, actor, deps?)
 *   actor: { id }  (the General Manager who asked; recorded as actorID)
 *   deps:  { query, withTransaction, submitHash } for tests
 * Returns { status: 'Confirmed' | 'Pending', txHash?, blockNumber?, validatorNodeCount?, error? }
 */
async function anchorReport(reportId, actor, deps = {}) {
  const query = deps.query || db.query;
  const withTransaction = deps.withTransaction || db.withTransaction;
  const submitHash = deps.submitHash || ((hash) => chain.submitHashWithTimeout(hash));

  const found = await query("SELECT * FROM report_events WHERE reportid = $1::uuid", [reportId]);
  if (found.rows.length === 0) throw httpError(404, "Report not found");
  const row = found.rows[0];

  if (row.anchorstatus === "Confirmed") return confirmedResult(query, reportId);

  // Never put a hash on the chain that the stored report no longer produces.
  if (chain.canonicalizeReport(row) !== row.payloadhash) {
    throw httpError(409, "The stored report no longer matches its hash, so it will not be anchored");
  }

  let sent;
  try {
    sent = await submitHash(row.payloadhash);
    if (!(sent.validatorNodeCount >= MIN_VALIDATORS)) {
      throw new Error(`only ${sent.validatorNodeCount} validator node(s) online; ${MIN_VALIDATORS} of 3 are required`);
    }
  } catch (error) {
    console.error(`Report ${reportId} anchor deferred:`, error.message);
    return { status: "Pending", error: error.message };
  }

  try {
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO blockchainlogs
           (reportid, actorid, txhash, blocknumber, eventtype, validatornodecount, consensustype)
         VALUES ($1, $2, $3, $4, 'ReportGenerated', $5, 'Clique')`,
        [reportId, actor.id, sent.txHash, sent.blockNumber, sent.validatorNodeCount]
      );
      await client.query("UPDATE report_events SET anchorstatus = 'Confirmed' WHERE reportid = $1::uuid", [reportId]);
    });
  } catch (error) {
    // Two requests anchored the same report at once and the other one won.
    // Trust that only if a log row for THIS report really exists; any other
    // duplicate (e.g. the same txHash) is a real error.
    if (error.code === "23505") {
      const result = await confirmedResult(query, reportId);
      if (result.txHash) return result;
    }
    throw error;
  }
  return {
    status: "Confirmed",
    txHash: sent.txHash,
    blockNumber: sent.blockNumber,
    validatorNodeCount: sent.validatorNodeCount,
  };
}

async function confirmedResult(query, reportId) {
  const log = await query(
    "SELECT txhash, blocknumber, validatornodecount FROM blockchainlogs WHERE reportid = $1::uuid",
    [reportId]
  );
  const row = log.rows[0] || {};
  return {
    status: "Confirmed",
    txHash: row.txhash,
    blockNumber: row.blocknumber,
    validatorNodeCount: row.validatornodecount,
  };
}

module.exports = { anchorReport, MIN_VALIDATORS };
