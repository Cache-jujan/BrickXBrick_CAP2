// The Purchase Order groups open requests per project (same grouping as To Buy) and escapes text.
import test from "node:test";
import assert from "node:assert/strict";
import { buildPurchaseOrder, renderPurchaseOrderHtml } from "../../purchase-order.js";

const req = (o) => ({ ticketID: "t", projectID: "p1", projectName: "Santos Residence", materialType: "Cement", remainingQuantity: 10, unit: "sacks", vendorName: null, createdAt: "2026-11-01T00:00:00Z", ...o });

test("groups per project and keeps each request's material, quantity and unit", () => {
  const groups = buildPurchaseOrder([
    req({ ticketID: "a" }),
    req({ ticketID: "b", projectID: "p2", projectName: "Reyes Warehouse", materialType: "10mm Rebar", remainingQuantity: 4, unit: "pcs", createdAt: "2026-11-05T00:00:00Z" }),
    req({ ticketID: "c", materialType: "10mm Rebar", remainingQuantity: 10, unit: "pcs" }),
  ]);
  assert.deepEqual(groups.map((g) => [g.projectName, g.items.map((i) => `${i.material} ${i.quantity} ${i.unit}`)]), [
    ["Santos Residence", ["Cement 10 sacks", "10mm Rebar 10 pcs"]],
    ["Reyes Warehouse", ["10mm Rebar 4 pcs"]],
  ]);
});

test("a request with nothing left to buy is not on the PO, and a missing unit stays blank", () => {
  const groups = buildPurchaseOrder([req({ remainingQuantity: 0 }), req({ ticketID: "x", unit: undefined })]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 1);
  assert.equal(groups[0].items[0].unit, "");
});

test("the HTML has the number, date, preparer, project, a printable box per item, and escapes text", () => {
  const groups = buildPurchaseOrder([req({ projectName: "A & B <Site>", materialType: "Cement" })]);
  const html = renderPurchaseOrderHtml(groups, {
    poNumber: "PO-2026-014", dateText: "November 20, 2026", preparedBy: "juan.purchaser", formatQty: String,
    labels: { title: "Purchase Order", date: "Date", preparedBy: "Prepared by", project: "Project", item: "Item", quantity: "Quantity", unit: "Unit", store: "Store" },
  });
  assert.match(html, /Purchase Order #PO-2026-014/);
  assert.match(html, /November 20, 2026/);
  assert.match(html, /juan\.purchaser/);
  assert.match(html, /Project: A &amp; B &lt;Site&gt;/);
  assert.equal((html.match(/class="check"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<Site>/);
});
