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
