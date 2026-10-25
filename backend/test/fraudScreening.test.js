const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createFraudScreening,
} = require("../src/lib/fraudScreening");

function fakeDatabase(responses) {
  let callNumber = 0;

  return async function fakeQuery(sql, params) {
    const response = responses[callNumber];
    callNumber += 1;

    return response || {
      rowCount: 0,
      rows: [],
    };
  };
}

test("incomplete BIR data is not treated as duplicate", async () => {
  let databaseCalled = false;

  const screening = createFraudScreening({
    query: async () => {
      databaseCalled = true;
      return { rowCount: 0, rows: [] };
    },
  });

  const result = await screening.checkDuplicate({
    expenseid: "expense-1",
    tin: "123",
    birnumber: "OR-1",
  });

  assert.equal(result, false);
  assert.equal(databaseCalled, false);
});

test("approved matching expense is treated as duplicate", async () => {
  const screening = createFraudScreening({
    query: fakeDatabase([
      {
        rowCount: 0,
        rows: [],
      },
      {
        rowCount: 1,
        rows: [
          {
            expenseid: "approved-expense",
            commonreceiptid: null,
          },
        ],
      },
    ]),
  });

  const result = await screening.checkDuplicate({
    expenseid: "new-expense",
    tin: "123",
    birpermitnumber: "PERMIT-1",
    birnumber: "OR-1",
  });

  assert.equal(result, true);
});

test("same split receipt is not treated as duplicate", async () => {
  const screening = createFraudScreening({
    query: fakeDatabase([
      {
        rowCount: 1,
        rows: [
          {
            commonreceiptid: "receipt-1",
          },
        ],
      },
      {
        rowCount: 2,
        rows: [
          {
            expenseid: "portion-1",
            commonreceiptid: "receipt-1",
          },
          {
            expenseid: "portion-2",
            commonreceiptid: "receipt-1",
          },
        ],
      },
    ]),
  });

  const result = await screening.checkDuplicate({
    expenseid: "portion-3",
    tin: "123",
    birpermitnumber: "PERMIT-1",
    birnumber: "OR-1",
  });

  assert.equal(result, false);
});

test("unknown vendor is flagged", async () => {
  const screening = createFraudScreening({
    query: async () => ({
      rowCount: 0,
      rows: [],
    }),
  });

  const result = await screening.checkVendor({
    vendorname: "Unknown Hardware",
  });

  assert.equal(result, "not_found");
});

test("flagged vendor is detected", async () => {
  const screening = createFraudScreening({
    query: async () => ({
      rowCount: 1,
      rows: [
        {
          approvalstatus: "Flagged",
        },
      ],
    }),
  });

  const result = await screening.checkVendor({
    vendorname: "Flagged Hardware",
  });

  assert.equal(result, "flagged");
});

test("ticket mismatch is detected", async () => {
  const screening = createFraudScreening({
    query: async () => ({
      rowCount: 1,
      rows: [
        {
          materialtype: "cement",
          quantity: "2",
          vendorname: "Approved Hardware",
        },
      ],
    }),
  });

  const result = await screening.checkTicketMismatch({
    ticketid: "ticket-1",
    category: "Equipment",
    quantity: 1,
    vendorname: "Wrong Vendor",
    lineitems: [
      {
        description: "Drill",
      },
    ],
  });

  assert.equal(result, true);
});

// ============================================================
// T2c-L3: BOM-aware material matching tests
// ============================================================

test("T2c-L3: BOM-linked ticket + matching expense line item = no mismatch", async () => {
  const bomItemID = "550e8400-e29b-41d4-a716-446655440000";

  const screening = createFraudScreening({
    query: async () => ({
      rowCount: 1,
      rows: [
        {
          tickettype: "Material Request",
          materialtype: "Portland Cement",
          quantity: "10",
          vendorname: "Hardware Store",
          bomitemid: bomItemID,
        },
      ],
    }),
  });

  const result = await screening.checkTicketMismatch({
    ticketid: "ticket-1",
    category: "Materials",
    quantity: 10,
    vendorname: "Hardware Store",
    lineitems: [
      {
        description: "Cement bags",
        amount: 5000,
        bomItemID: bomItemID,
      },
    ],
  });

  assert.equal(result, false, "Should not flag mismatch when bomItemID matches");
});

test("T2c-L3: BOM-linked ticket + non-matching expense line item = mismatch", async () => {
  const ticketBomItemID = "550e8400-e29b-41d4-a716-446655440000";
  const expenseBomItemID = "660e8400-e29b-41d4-a716-446655440001";

  const screening = createFraudScreening({
    query: async () => ({
      rowCount: 1,
      rows: [
        {
          tickettype: "Material Request",
          materialtype: "Portland Cement",
          quantity: "10",
          vendorname: "Hardware Store",
          bomitemid: ticketBomItemID,
        },
      ],
    }),
  });

  const result = await screening.checkTicketMismatch({
    ticketid: "ticket-1",
    category: "Materials",
    quantity: 10,
    vendorname: "Hardware Store",
    lineitems: [
      {
        description: "Cement bags",
        amount: 5000,
        bomItemID: expenseBomItemID, // Different BOM item
      },
    ],
  });

  assert.equal(result, true, "Should flag mismatch when bomItemID differs");
});

test("T2c-L3: BOM-linked ticket + expense without bomItemID = mismatch", async () => {
  const ticketBomItemID = "550e8400-e29b-41d4-a716-446655440000";

  const screening = createFraudScreening({
    query: async () => ({
      rowCount: 1,
      rows: [
        {
          tickettype: "Material Request",
          materialtype: "Portland Cement",
          quantity: "10",
          vendorname: "Hardware Store",
          bomitemid: ticketBomItemID,
        },
      ],
    }),
  });

  const result = await screening.checkTicketMismatch({
    ticketid: "ticket-1",
    category: "Materials",
    quantity: 10,
    vendorname: "Hardware Store",
    lineitems: [
      {
        description: "Cement bags",
        amount: 5000,
        // No bomItemID
      },
    ],
  });

  assert.equal(result, true, "Should flag mismatch when ticket has bomItemID but expense doesn't");
});

test("T2c-L3: BOM-linked ticket + multiple expense items, one matches = no mismatch", async () => {
  const bomItemID = "550e8400-e29b-41d4-a716-446655440000";

  const screening = createFraudScreening({
    query: async () => ({
      rowCount: 1,
      rows: [
        {
          tickettype: "Material Request",
          materialtype: "Portland Cement",
          quantity: "10",
          vendorname: "Hardware Store",
          bomitemid: bomItemID,
        },
      ],
    }),
  });

  const result = await screening.checkTicketMismatch({
    ticketid: "ticket-1",
    category: "Materials",
    quantity: 10,
    vendorname: "Hardware Store",
    lineitems: [
      {
        description: "Nails",
        amount: 500,
        // No bomItemID
      },
      {
        description: "Cement bags",
        amount: 5000,
        bomItemID: bomItemID, // This one matches!
      },
      {
        description: "Sand",
        amount: 2000,
        // No bomItemID
      },
    ],
  });

  assert.equal(result, false, "Should not flag mismatch when ANY expense line item matches bomItemID");
});

test("T2c-L3: non-BOM ticket falls back to text matching (match)", async () => {
  const screening = createFraudScreening({
    query: async () => ({
      rowCount: 1,
      rows: [
        {
          tickettype: "Material Request",
          materialtype: "Portland Cement",
          quantity: "10",
          vendorname: "Hardware Store",
          bomitemid: null, // No BOM link
        },
      ],
    }),
  });

  const result = await screening.checkTicketMismatch({
    ticketid: "ticket-1",
    category: "Materials",
    quantity: 10,
    vendorname: "Hardware Store",
    lineitems: [
      {
        description: "Portland Cement bags 40kg",
        amount: 5000,
        // No bomItemID needed for text matching
      },
    ],
  });

  assert.equal(result, false, "Should use text matching when ticket has no bomItemID");
});

test("T2c-L3: non-BOM ticket falls back to text matching (mismatch)", async () => {
  const screening = createFraudScreening({
    query: async () => ({
      rowCount: 1,
      rows: [
        {
          tickettype: "Material Request",
          materialtype: "Portland Cement",
          quantity: "10",
          vendorname: "Hardware Store",
          bomitemid: null, // No BOM link
        },
      ],
    }),
  });

  const result = await screening.checkTicketMismatch({
    ticketid: "ticket-1",
    category: "Materials",
    quantity: 10,
    vendorname: "Hardware Store",
    lineitems: [
      {
        description: "Gravel and sand mix",
        amount: 5000,
        // Text doesn't match "Portland Cement"
      },
    ],
  });

  assert.equal(result, true, "Should flag mismatch when text doesn't match materialtype");
});

test("T2c-L3: non-BOM ticket with bomItemID in expense still uses text matching", async () => {
  const expenseBomItemID = "550e8400-e29b-41d4-a716-446655440000";

  const screening = createFraudScreening({
    query: async () => ({
      rowCount: 1,
      rows: [
        {
          tickettype: "Material Request",
          materialtype: "steel bars",
          quantity: "50",
          vendorname: "Steel Supply",
          bomitemid: null, // Ticket not BOM-linked
        },
      ],
    }),
  });

  const result = await screening.checkTicketMismatch({
    ticketid: "ticket-1",
    category: "Materials",
    quantity: 50,
    vendorname: "Steel Supply",
    lineitems: [
      {
        description: "Deformed steel bars 12mm",
        amount: 15000,
        bomItemID: expenseBomItemID, // Expense has BOM link but ticket doesn't
      },
    ],
  });

  assert.equal(result, false, "Should use text matching (not BOM) when ticket lacks bomItemID, even if expense has one");
});

test("T2c-L3: BOM-linked ticket with empty expense lineitems = mismatch", async () => {
  const ticketBomItemID = "550e8400-e29b-41d4-a716-446655440000";

  const screening = createFraudScreening({
    query: async () => ({
      rowCount: 1,
      rows: [
        {
          tickettype: "Material Request",
          materialtype: "Portland Cement",
          quantity: "10",
          vendorname: "Hardware Store",
          bomitemid: ticketBomItemID,
        },
      ],
    }),
  });

  const result = await screening.checkTicketMismatch({
    ticketid: "ticket-1",
    category: "Materials",
    quantity: 10,
    vendorname: "Hardware Store",
    lineitems: [], // Empty array
  });

  assert.equal(result, true, "Should flag mismatch when expense has no line items but ticket has bomItemID");
});

test("a smaller quantity is fine when the expense is a portion of an allocation", async () => {
  const screening = createFraudScreening({
    query: async (sql) =>
      /receiptallocations/i.test(sql)
        ? { rowCount: 1, rows: [{ "?column?": 1 }] }
        : { rowCount: 1, rows: [{ materialtype: "Cement", quantity: "50", vendorname: "Padeena" }] },
  });

  const result = await screening.checkTicketMismatch({
    expenseid: "e1",
    ticketid: "t1",
    quantity: 30,
    vendorname: "Padeena",
    lineitems: [{ description: "Cement" }],
  });

  assert.equal(result, false);
});

test("a smaller quantity is still a mismatch for a plain expense", async () => {
  const screening = createFraudScreening({
    query: async (sql) =>
      /receiptallocations/i.test(sql)
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [{ materialtype: "Cement", quantity: "50", vendorname: "Padeena" }] },
  });

  const result = await screening.checkTicketMismatch({
    expenseid: "e1",
    ticketid: "t1",
    quantity: 30,
    vendorname: "Padeena",
    lineitems: [{ description: "Cement" }],
  });

  assert.equal(result, true);
});

test("more than requested is a mismatch even for an allocation portion", async () => {
  const screening = createFraudScreening({
    query: async () => ({ rowCount: 1, rows: [{ materialtype: "Cement", quantity: "50", vendorname: "Padeena" }] }),
  });

  const result = await screening.checkTicketMismatch({
    expenseid: "e1",
    ticketid: "t1",
    quantity: 60,
    vendorname: "Padeena",
    lineitems: [{ description: "Cement" }],
  });

  assert.equal(result, true);
});
