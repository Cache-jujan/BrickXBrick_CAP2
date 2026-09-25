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

// Layer 3: compares expense against ticket's structured procurement fields
// (materialType, quantity, vendorName) — added via F4 PR. Report tickets have
// no procurement fields (free-text only), so they're skipped, not flagged.
async function checkTicketMismatch(expense) {
  if (!expense.ticketID) return false;

  const ticketResult = await query(
    "SELECT tickettype, materialtype, quantity, vendorname FROM Tickets WHERE ticketid = $1",
    [expense.ticketID]
  );
  if (ticketResult.rows.length === 0) return false;

  const ticket = ticketResult.rows[0];

  // Report tickets are free-text, no procurement fields to compare against
  if (!ticket.materialtype) return false;

  const expenseText = `${expense.category || ""} ${expense.lineItems || ""} ${expense.vendorName || ""}`.toLowerCase();
  const materialMismatch = !expenseText.includes(ticket.materialtype.toLowerCase());
  const quantityMismatch = ticket.quantity != null && expense.quantity != null
    && Number(expense.quantity) !== Number(ticket.quantity);
  const vendorMismatch = ticket.vendorname
    && expense.vendorName?.trim().toLowerCase() !== ticket.vendorname.trim().toLowerCase();

  return materialMismatch || quantityMismatch || vendorMismatch;
}

module.exports = { checkDuplicate, checkVendor, checkTicketMismatch };