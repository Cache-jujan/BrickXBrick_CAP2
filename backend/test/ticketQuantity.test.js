const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeLineItems } = require("../src/lib/receiptFields");
const { quantityOfMatchedLines } = require("../src/lib/ticketQuantity");

const TICKET_ID = "7c2f6f0e-5a3b-4c1d-9e8f-0a1b2c3d4e5f";
const BOM_ID = "11111111-2222-4333-8444-555555555555";
const bomTicket = { materialtype: "Cement", bomitemid: BOM_ID };

test("normalizeLineItems keeps a valid matchedTicketID and drops a bad one", () => {
  const [kept, dropped, none] = normalizeLineItems([
    { description: "Delivery", amount: 100, quantity: 3, matchedTicketID: TICKET_ID },
    { description: "Sand", amount: 50, quantity: 1, matchedTicketID: "not-a-uuid" },
    { description: "Gravel", amount: 50, quantity: 1 },
  ]);
  assert.equal(kept.matchedTicketID, TICKET_ID);
  assert.equal("matchedTicketID" in dropped, false);
  assert.equal("matchedTicketID" in none, false);
});

test("a BOM request counts a differently named line matched to it, after normalizing", () => {
  const lines = normalizeLineItems([
    { description: "Cement", amount: 100, quantity: 2, bomItemID: BOM_ID },
    { description: "Portland bags", amount: 150, quantity: 3, matchedTicketID: TICKET_ID },
    { description: "Sand", amount: 80, quantity: 8 },
  ]);
  assert.equal(quantityOfMatchedLines(lines, bomTicket, TICKET_ID), 5);
});

test("a line matched to another request is not counted", () => {
  const lines = normalizeLineItems([
    { description: "Portland bags", amount: 150, quantity: 3, matchedTicketID: "99999999-2222-4333-8444-555555555555" },
  ]);
  assert.equal(quantityOfMatchedLines(lines, bomTicket, TICKET_ID), null);
});
