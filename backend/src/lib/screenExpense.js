// screenExpense.js — F9 shared helper. Runs every screening layer on one
// expense and writes FraudFlags for the PM review queue.
//
// ALWAYS call this AFTER COMMIT, never inside a transaction. It reads through
// the shared pool, which can't see uncommitted rows.
//
// Finding nothing is not an error: it returns { flagTypes: [] }.

const { createFraudScreening } = require("./fraudScreening");
const { compareWithScan, manualEntryReason } = require("./scanComparison");

const DUPLICATE_REASON =
  "Duplicate: same TIN, BIR permit number, and BIR number as an existing expense";
const TICKET_MISMATCH_REASON =
  "Expense does not match ticket material type, quantity, or vendor";

// The review screen names its reconciliation line "Adjustment ..." (mobile
// lib/receipt-checks.ts, ADJUSTMENT_PREFIX). Keep the two in step.
const ADJUSTMENT_LINE = /^adjustment\b/i;

// lineitems is jsonb, but a row written as a JSON string still parses.
function adjustmentLines(lineitems) {
  let items = lineitems;
  if (typeof items === "string") {
    try { items = JSON.parse(items); } catch { return []; }
  }
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && ADJUSTMENT_LINE.test(String(item.description || "").trim()));
}

function adjustmentReason(lines) {
  const parts = lines.map((line) => `${String(line.description).trim()} (₱${Number(line.amount || 0).toFixed(2)})`);
  return `Line items were adjusted to match the receipt total: ${parts.join("; ")}`;
}

async function screenExpense(expenseID, { query } = {}) {
  // Lazy require so unit tests can pass a fake query without a database.
  const runQuery = query || require("./db").query;
  const { checkDuplicate, checkVendor, checkTicketMismatch } =
    createFraudScreening({ query: runQuery });

  // SELECT * gives lowercase keys, which is what the checks read.
  const rowResult = await runQuery(
    "SELECT * FROM expenses WHERE expenseid = $1",
    [expenseID]
  );
  const expense = rowResult.rows[0];
  if (!expense) {
    return { flagTypes: [] };
  }

  const flagTypes = [];

  async function addFlag(flagType, reason) {
    await runQuery(
      `INSERT INTO FraudFlags (expenseID, flagType, reason, flaggedBy, resolution)
       VALUES ($1, $2, $3, 'system', 'Pending')`,
      [expense.expenseid, flagType, reason]
    );
    flagTypes.push(flagType);
  }

  // Layer 1: BIR duplicate against Approved expenses
  if (await checkDuplicate(expense)) {
    await addFlag("BIR_Duplicate", DUPLICATE_REASON);
  }

  // Layer 2: Vendor Master List
  const vendorIssue = await checkVendor(expense);
  if (vendorIssue) {
    const reason =
      vendorIssue === "not_found"
        ? "Vendor not found in VendorMasterList"
        : "Vendor found in VendorMasterList but approvalStatus = 'Flagged'";
    await addFlag("Vendor_Validation", reason);
  }

  // Layer 3: ticket vs receipt. Today it returns true/false; after the
  // Layer 3 rewrite it returns a reason string, which is stored as-is.
  const mismatch = await checkTicketMismatch(expense);
  if (mismatch) {
    const reason = typeof mismatch === "string" ? mismatch : TICKET_MISMATCH_REASON;
    await addFlag("Ticket_Mismatch", reason);
  }

  // Layer 4: the submitter closed a totals gap with an adjustment line.
  const adjustments = adjustmentLines(expense.lineitems);
  if (adjustments.length > 0) {
    await addFlag("Receipt_Adjustment", adjustmentReason(adjustments));
  }

  // Compare with what the server's own scan read from this image.
  const scanCheck = await checkAgainstScan(expense, runQuery);
  if (scanCheck) {
    await addFlag(scanCheck.flagType, scanCheck.reason);
  }

  return { flagTypes };
}

// The newest successful scan of this image wins over a failed retry.
async function loadScan(receiptImageURL, runQuery) {
  const result = await runQuery(
    `SELECT status, result
       FROM receiptscans
      WHERE receiptimageurl = $1
      ORDER BY (status = 'Ready') DESC, createdat DESC
      LIMIT 1`,
    [receiptImageURL]
  );
  const scan = result.rows[0];
  if (!scan) return null;
  let draft = scan.result;
  if (typeof draft === "string") {
    try { draft = JSON.parse(draft); } catch { draft = null; }
  }
  return { status: scan.status, result: draft };
}

// One portion of a split receipt: the receipt total is the sum of all its
// portions, since each portion stores only its own share.
async function loadSplitTotal(expenseID, runQuery) {
  const result = await runQuery(
    `SELECT (SELECT SUM(e2.amount)
               FROM receiptallocations ra2
               JOIN expenses e2 ON e2.expenseid = ra2.expenseid
              WHERE ra2.commonreceiptid = ra.commonreceiptid) AS receipttotal
       FROM receiptallocations ra
      WHERE ra.expenseid = $1`,
    [expenseID]
  );
  return result.rows[0] ? result.rows[0].receipttotal : null;
}

async function checkAgainstScan(expense, runQuery) {
  if (!expense.receiptimageurl) return null;
  const scan = await loadScan(expense.receiptimageurl, runQuery);
  const manual = manualEntryReason(scan);
  if (manual) return { flagType: "Manual_Entry", reason: manual };

  const splitTotal = await loadSplitTotal(expense.expenseid, runQuery);
  const { reason } = compareWithScan({
    expense,
    draft: scan.result,
    receiptAmount: splitTotal ?? expense.amount,
    split: splitTotal !== null,
  });
  return reason ? { flagType: "Receipt_Edited", reason } : null;
}

module.exports = { screenExpense, adjustmentLines };
