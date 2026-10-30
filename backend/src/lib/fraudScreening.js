// F9: Multi-layer expense screening

// Case- and spacing-insensitive text for comparing names ("CEMENT " = "cement").
function normalize(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// lineitems is jsonb, but some rows hold it double-encoded (a JSON string of
// the array), which pg hands back as a string. Read both shapes.
function parseLineItems(lineItems) {
  let items = lineItems;
  if (typeof items === "string") {
    try { items = JSON.parse(items); } catch { return []; }
  }
  return Array.isArray(items) ? items : [];
}

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
  // matching is BOM-aware: a receipt line matches when it carries the ticket's
  // bomItemID, was matched to this ticket on the review screen (matchedTicketID),
  // or was left unlinked but reads exactly the requested material (an OCR line
  // "CEMENT" against a "CEMENT" request). A line linked to a different BOM item
  // never matches by its text. If the ticket has no bomitemid, we fall back to
  // the original free-text substring match.
  //
  // Returns the list of things that differ (empty when the expense matches), so
  // the flag can say which one it was instead of "material, quantity or store".
  async function findTicketMismatches(expense) {
    const ticketId =
      expense?.ticketid ?? expense?.ticketID;

    if (!ticketId) {
      return [];
    }

    const ticketResult = await runQuery(
      `SELECT tickettype, materialtype, quantity, vendorname, bomitemid
         FROM tickets
        WHERE ticketid = $1`,
      [ticketId]
    );

    if (ticketResult.rowCount === 0) {
      return [];
    }

    const ticket = ticketResult.rows[0];

    // Report tickets do not have structured procurement data.
    if (!ticket.materialtype) {
      return [];
    }

    const itemsArray = parseLineItems(
      expense.lineitems ?? expense.lineItems
    );

    const problems = [];

    if (ticket.bomitemid) {
      const requestedName = normalize(ticket.materialtype);
      const bomMatch = itemsArray.some((item) => {
        if (!item) return false;
        if (item.bomItemID === ticket.bomitemid) return true;
        if (item.matchedTicketID != null && String(item.matchedTicketID) === String(ticketId)) return true;
        return !item.bomItemID && normalize(item.description) === requestedName;
      });

      if (!bomMatch) {
        problems.push(
          `Material: no receipt line is matched to the requested "${ticket.materialtype}"`
        );
      }
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

      if (!expenseText.includes(String(ticket.materialtype).toLowerCase())) {
        problems.push(
          `Material: "${ticket.materialtype}" is not on the receipt`
        );
      }
    }

    // More than requested is always a mismatch. Less is one too, unless the expense
    // is a portion of an allocation: a request is bought in several trips, so a
    // smaller quantity is expected there.
    if (ticket.quantity != null && expense.quantity != null) {
      const requested = Number(ticket.quantity);
      const bought = Number(expense.quantity);
      const differs =
        bought > requested ||
        (bought < requested && !(await isAllocationPortion(expense)));
      if (differs) {
        problems.push(
          `Quantity: ${bought} on the receipt, ${requested} requested`
        );
      }
    }

    const expenseVendor = expense.vendorname || expense.vendorName || "";
    if (
      ticket.vendorname &&
      normalize(expenseVendor) !== normalize(ticket.vendorname)
    ) {
      problems.push(
        `Store: "${expenseVendor || "none"}" on the receipt, "${ticket.vendorname}" requested`
      );
    }

    return problems;
  }

  async function checkTicketMismatch(expense) {
    return (await findTicketMismatches(expense)).length > 0;
  }

  // The flag reason: which parts differ, or false when nothing does.
  async function describeTicketMismatch(expense) {
    const problems = await findTicketMismatches(expense);
    return problems.length > 0 ? problems.join("; ") : false;
  }

  return {
    checkDuplicate,
    checkVendor,
    checkTicketMismatch,
    describeTicketMismatch,
  };
}


const defaultScreening = createFraudScreening();

module.exports = {
  createFraudScreening,
  checkDuplicate: defaultScreening.checkDuplicate,
  checkVendor: defaultScreening.checkVendor,
  checkTicketMismatch: defaultScreening.checkTicketMismatch,
  describeTicketMismatch: defaultScreening.describeTicketMismatch,
};