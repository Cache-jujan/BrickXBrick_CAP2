// F9: Multi-layer expense screening

function createFraudScreening({ query } = {}) {
  const runQuery = query || require("./db").query;

  // Layer 1: BIR duplicate checking
  async function checkDuplicate(expense) {
    const {
      tin,
      birpermitnumber,
      birnumber,
      expenseid,
    } = expense || {};

    // Informal receipts do not have enough BIR information to compare.
    if (!tin || !birpermitnumber || !birnumber) {
      return false;
    }

    // Find the current expense's split-receipt group, if any.
    const ownAllocation = await runQuery(
      `SELECT commonreceiptid
         FROM receiptallocations
        WHERE expenseid = $1`,
      [expenseid]
    );

    const ownCommonReceiptId =
      ownAllocation.rows[0]?.commonreceiptid ?? null;

    // Only approved expenses count as duplicates.
    const matches = await runQuery(
      `SELECT e.expenseid, ra.commonreceiptid
         FROM expenses e
         LEFT JOIN receiptallocations ra
           ON ra.expenseid = e.expenseid
        WHERE e.status = 'Approved'
          AND e.tin = $1
          AND e.birpermitnumber = $2
          AND e.birnumber = $3
          AND e.expenseid <> $4`,
      [tin, birpermitnumber, birnumber, expenseid]
    );

    if (matches.rowCount === 0) {
      return false;
    }

    // F8 exception:
    // portions from the same receipt are not duplicates of each other.
    if (ownCommonReceiptId) {
      const sameSplitReceipt = matches.rows.every(
        (match) =>
          match.commonreceiptid === ownCommonReceiptId
      );

      if (sameSplitReceipt) {
        return false;
      }
    }

    return true;
  }

  // Layer 2: Vendor Master List validation
  async function checkVendor(expense) {
    const vendorName =
      expense?.vendorname ?? expense?.vendorName;

    if (!vendorName) {
      return false;
    }

    const result = await runQuery(
      `SELECT vendorid, approvalstatus
         FROM vendormasterlist
        WHERE LOWER(TRIM(vendorname))
            = LOWER(TRIM($1))`,
      [vendorName]
    );

    if (result.rowCount === 0) {
      return "not_found";
    }

    if (result.rows[0].approvalstatus === "Flagged") {
      return "flagged";
    }

    return false;
  }

  // Layer 3: Ticket/receipt mismatch validation
  async function checkTicketMismatch(expense) {
    const ticketId =
      expense?.ticketid ?? expense?.ticketID;

    if (!ticketId) {
      return false;
    }

    const ticketResult = await runQuery(
      `SELECT tickettype, materialtype, quantity, vendorname
         FROM tickets
        WHERE ticketid = $1`,
      [ticketId]
    );

    if (ticketResult.rowCount === 0) {
      return false;
    }

    const ticket = ticketResult.rows[0];

    // Report tickets do not have structured procurement data.
    if (!ticket.materialtype) {
      return false;
    }

    const lineItems =
      expense.lineitems ?? expense.lineItems;

    const items = Array.isArray(lineItems)
      ? lineItems
          .map((item) => item.description || "")
          .join(" ")
      : String(lineItems || "");

    const expenseText = `
      ${expense.category || ""}
      ${items}
      ${expense.vendorname || expense.vendorName || ""}
    `.toLowerCase();

    const materialMismatch =
      !expenseText.includes(
        String(ticket.materialtype).toLowerCase()
      );

    const quantityMismatch =
      ticket.quantity != null &&
      expense.quantity != null &&
      Number(ticket.quantity) !== Number(expense.quantity);

    const vendorMismatch =
      ticket.vendorname &&
      String(
        expense.vendorname || expense.vendorName || ""
      ).trim().toLowerCase() !==
        String(ticket.vendorname)
          .trim()
          .toLowerCase();

    return Boolean(
      materialMismatch ||
      quantityMismatch ||
      vendorMismatch
    );
  }

  return {
    checkDuplicate,
    checkVendor,
    checkTicketMismatch,
  };
}


const defaultScreening = createFraudScreening();

module.exports = {
  createFraudScreening,
  checkDuplicate: defaultScreening.checkDuplicate,
  checkVendor: defaultScreening.checkVendor,
  checkTicketMismatch: defaultScreening.checkTicketMismatch,
};