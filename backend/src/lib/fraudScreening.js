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

  async function isAllocationPortion(expense) {
    const expenseId = expense?.expenseid ?? expense?.expenseID;
    if (!expenseId) {
      return false;
    }
    const result = await runQuery(
      `SELECT 1 FROM receiptallocations WHERE expenseid = $1`,
      [expenseId]
    );
    return result.rowCount > 0;
  }

  // Layer 3: Ticket/receipt mismatch validation
  //
  // T2c-L3: when the ticket is BOM-linked (tickets.bomitemid is set), material
  // matching is BOM-aware — the expense line items are checked for a matching
  // bomItemID instead of free-text matching. If the ticket has no bomitemid,
  // we fall back to the original free-text substring match.
  async function checkTicketMismatch(expense) {
    const ticketId =
      expense?.ticketid ?? expense?.ticketID;

    if (!ticketId) {
      return false;
    }

    const ticketResult = await runQuery(
      `SELECT tickettype, materialtype, quantity, vendorname, bomitemid
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

    const itemsArray = Array.isArray(lineItems) ? lineItems : [];

    let materialMismatch;

    if (ticket.bomitemid) {
      // BOM-aware path: mismatch unless at least one expense line item
      // carries the same bomItemID as the ticket.
      const bomMatch = itemsArray.some(
        (item) => item?.bomItemID === ticket.bomitemid
      );

      materialMismatch = !bomMatch;
    } else {
      // Fallback path: ticket has no BOM link, use free-text matching.
      const items = itemsArray
        .map((item) => item.description || "")
        .join(" ");

      const expenseText = `
        ${expense.category || ""}
        ${items}
        ${expense.vendorname || expense.vendorName || ""}
      `.toLowerCase();

      materialMismatch =
        !expenseText.includes(
          String(ticket.materialtype).toLowerCase()
        );
    }

    // More than requested is always a mismatch. Less is one too, unless the expense
    // is a portion of an allocation: a request is bought in several trips, so a
    // smaller quantity is expected there.
    let quantityMismatch = false;
    if (ticket.quantity != null && expense.quantity != null) {
      const requested = Number(ticket.quantity);
      const bought = Number(expense.quantity);
      if (bought > requested) {
        quantityMismatch = true;
      } else if (bought < requested) {
        quantityMismatch = !(await isAllocationPortion(expense));
      }
    }

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