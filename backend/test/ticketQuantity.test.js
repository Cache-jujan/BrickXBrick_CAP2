const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLineItems } = require('../src/lib/receiptFields');
const { quantityOfMatchedLines } = require('../src/lib/ticketQuantity');
const ticketID = '33333333-3333-4333-8333-333333333333';
const bomItemID = '44444444-4444-4444-8444-444444444444';
test('normalized explicit ticket matches survive and frontend agrees with server', async () => {
  const { matchedQuantity } = await import('../../frontend/src/utils/requestProgress.js');
  const ticket = { materialtype: 'Cement', bomitemid: bomItemID };
  const lines = normalizeLineItems([
    { description: 'Brand product', quantity: 2, amount: 20, matchedTicketID: ticketID },
    { description: 'Other', quantity: 3, amount: 30, bomItemID },
    { description: ' CEMENT ', quantity: 4, amount: 40 },
    { description: 'Portland cement', quantity: 20, amount: 100 },
    { description: 'Sand', quantity: 10, amount: 100, matchedTicketID: {} },
  ]);
  assert.equal(lines[0].matchedTicketID, ticketID);
  assert.equal(lines[4].matchedTicketID, undefined);
  assert.equal(quantityOfMatchedLines(lines, ticket, ticketID), 9);
  assert.equal(matchedQuantity(lines, 'Cement', bomItemID, ticketID), 9);
  for (const unmatched of [[lines[3]], [{ description: 'Cement', quantity: null }]]) {
    assert.equal(quantityOfMatchedLines(unmatched, ticket, ticketID), null);
    assert.equal(matchedQuantity(unmatched, 'Cement', bomItemID, ticketID), null);
  }
  assert.equal(matchedQuantity([lines[3]], 'Cement'), 20);
});
