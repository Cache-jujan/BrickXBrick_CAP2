// F12: one integrity check used by the background scan AND the GM's
// "Check for changes" button, so both always agree.
//
// The proof is the FIRST hash written to the chain when the expense was
// approved. The expense's blockchainStatus column is only a cached result:
// it is recomputed on every check, so editing it (e.g. back to 'Confirmed',
// or to 'Pending' to get a new hash written) hides nothing.
//
// Alerts: one per expense per changed version of its data. If an alert row
// is deleted while the data still differs, the next check creates it again.
// Resolving an alert never clears the expense's "changed" status; only data
// that matches the approved hash again does (the alert is then stamped
// restoredAt but stays on record).
const { query: defaultQuery } = require("./db");
const { canonicalizeExpense, getOnChainHash: defaultGetHash } = require("./blockchainService");
const { raiseTamperAlert } = require("./tamperAlerts");

const SCAN_BATCH = 100;

// Earliest approval record = the hash secured at approval time.
async function firstChainRecord(runQuery, expenseId) {
  const r = await runQuery(
    `SELECT * FROM BlockchainLogs
      WHERE expenseID = $1::uuid AND eventType = 'ExpenseApproved'
      ORDER BY timestamp ASC, blockNumber ASC
      LIMIT 1`,
    [expenseId]
  );
  return r.rows[0] || null;
}

/**
 * Returns { state, log, recomputedHash, onChainHash, alertCreated }
 *   state: 'NotSecured'  no chain record yet (nothing to compare)
 *          'Unreachable' chain nodes didn't answer (NOT tampering; nothing changed)
 *          'Match'       data equals what was approved
 *          'Mismatch'    data changed after approval (or the chain record is missing)
 */
async function checkExpenseIntegrity(expense, deps = {}) {
  const runQuery = deps.query || defaultQuery;
  const getHash = deps.getOnChainHash || defaultGetHash;
  const raise = deps.raiseTamperAlert || raiseTamperAlert;

  const log = await firstChainRecord(runQuery, expense.expenseid);
  if (!log) return { state: "NotSecured", log: null };

  const recomputedHash = canonicalizeExpense(expense);
  let onChainHash;
  try {
    onChainHash = await getHash(log.txhash);
  } catch {
    return { state: "Unreachable", log };
  }

  if (onChainHash !== null && onChainHash === recomputedHash) {
    await runQuery(
      `UPDATE Expenses SET blockchainStatus = 'Confirmed', lastIntegrityCheckAt = NOW()
        WHERE expenseID = $1::uuid`,
      [expense.expenseid]
    );
    // Data is back to its approved values: note it on any alert, keep the alert.
    await runQuery(
      `UPDATE tamper_alerts SET restoredAt = NOW()
        WHERE expenseID = $1::uuid AND restoredAt IS NULL`,
      [expense.expenseid]
    );
    return { state: "Match", log, recomputedHash, onChainHash };
  }

  await runQuery(
    `UPDATE Expenses SET blockchainStatus = 'TamperDetected', lastIntegrityCheckAt = NOW()
      WHERE expenseID = $1::uuid`,
    [expense.expenseid]
  );
  const reason = onChainHash === null
    ? `on-chain transaction ${log.txhash} could not be found`
    : "recomputed hash does not match the hash secured at approval";
  const { created } = await raise(expense, recomputedHash, onChainHash, reason, { query: runQuery });
  return { state: "Mismatch", log, recomputedHash, onChainHash, alertCreated: created };
}

/**
 * Background scan: every expense that has a chain record, whatever its
 * blockchainStatus says, least recently checked first.
 */
async function runIntegrityScan(deps = {}) {
  const runQuery = deps.query || defaultQuery;
  const batch = deps.batchSize || SCAN_BATCH;
  const result = await runQuery(
    `SELECT e.* FROM Expenses e
      WHERE EXISTS (SELECT 1 FROM BlockchainLogs bl
                     WHERE bl.expenseID = e.expenseID AND bl.eventType = 'ExpenseApproved')
      ORDER BY e.lastIntegrityCheckAt ASC NULLS FIRST
      LIMIT $1::int`,
    [batch]
  );
  const counts = { checked: 0, match: 0, mismatch: 0, unreachable: 0, newAlerts: 0 };
  for (const expense of result.rows) {
    try {
      const r = await checkExpenseIntegrity(expense, deps);
      counts.checked += 1;
      if (r.state === "Match") counts.match += 1;
      if (r.state === "Mismatch") counts.mismatch += 1;
      if (r.alertCreated) counts.newAlerts += 1;
      if (r.state === "Unreachable") {
        counts.unreachable += 1;
        break; // chain is down: stop this pass, try again next time
      }
    } catch (e) {
      console.error(`Integrity check crashed on expense ${expense.expenseid}:`, e.message);
    }
  }
  return counts;
}

module.exports = { checkExpenseIntegrity, runIntegrityScan, firstChainRecord };
