// fraudScreening.js — F9 Layer 1: BIR duplicate check.
// Flags an expense whose TIN + BIR permit number + BIR/OR-SI number

const { query } = require("./db");

async function checkDuplicate(expense) {
    const { tin, birpermitnumber, birnumber, expenseid } = expense;

    if (!tin || !birpermitnumber || !birnumber) return false;

    const result = await query(
        `SELECT expenseID FROM Expenses
         WHERE tin = $1 AND birPermitNumber = $2 AND birNumber = $3
         AND expenseID != $4`,
        [tin, birpermitnumber, birnumber, expenseid]
    );

    return result.rowCount > 0;
}

// Layer 2: vendor validation.
// Flags an expense if its vendorName has no match in VendorMasterList
// (case-insensitive, trimmed), or if the matched vendor's approvalStatus
// is 'Flagged'.
// NOTE: amount-deviation vs historicalAverage is a separate check, deferred —
// scope not confirmed for F9, raise with team before building.
async function checkVendor(expense) {
    const { vendorname } = expense;

    if (!vendorname) return false;

    const result = await query(
        `SELECT vendorID, approvalStatus FROM VendorMasterList
         WHERE LOWER(TRIM(vendorName)) = LOWER(TRIM($1))`,
        [vendorname]
    );

    if (result.rowCount === 0) return "not_found";

    if (result.rows[0].approvalstatus === "Flagged") return "flagged";

    return false;
}

module.exports = { checkDuplicate, checkVendor };