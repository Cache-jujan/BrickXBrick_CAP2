// Builds the printable Purchase Order from the open requests an app already has. Shared by the phone app
// (PDF through expo-print) and the web (browser print dialog), so both produce the same page.
// Nothing is saved. The grouping is each app's own existing groupByProject, passed in, so a PO always
// matches the project grouping on that app's screens and there is no second grouping algorithm here.
// Pure (no React, no Expo, no DOM), so it is tested in Node (mobile/lib/sync/test/purchase-order.test.mjs).

/**
 * What to buy per project. Quantity is what is still left to buy on each request.
 * Requests with nothing left are skipped. Only these fields are read: no budget amounts ever reach a PO.
 * @param {{ ticketID: string, projectID: string, projectName: string, materialType: string,
 *           remainingQuantity: number, unit?: string|null, vendorName?: string|null, createdAt?: string|null }[]} requests
 * @param {(requests: any[]) => { projectId: string, projectName: string, items: any[] }[]} groupByProject
 *   the app's own grouping, returning each group's requests as `items`
 * @returns {{ projectId: string, projectName: string,
 *             items: { ticketID: string, material: string, quantity: number, unit: string, store: string }[] }[]}
 */
export function buildPurchaseOrder(requests, groupByProject) {
  const open = requests.filter((r) => Number(r.remainingQuantity) > 0);
  return groupByProject(open).map((group) => ({
    projectId: group.projectId,
    projectName: group.projectName,
    items: group.items.map((r) => ({
      ticketID: r.ticketID,
      material: r.materialType,
      quantity: Number(r.remainingQuantity),
      unit: r.unit ?? "",
      store: r.vendorName ?? "",
    })),
  }));
}

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * The PO as one printable page of HTML (expo-print turns it into a PDF).
 * The checkbox is a drawn square, not a font glyph, so it prints the same on every phone.
 * @param {ReturnType<typeof buildPurchaseOrder>} groups
 * @param {{ poNumber: string, dateText: string, preparedBy: string,
 *           formatQty: (n: number) => string,
 *           labels: { title: string, date: string, preparedBy: string, project: string, item: string,
 *                     quantity: string, unit: string, store: string } }} options
 */
export function renderPurchaseOrderHtml(groups, { poNumber, dateText, preparedBy, formatQty, labels }) {
  const e = escapeHtml;
  const sections = groups.map((group) => `
    <section>
      <h2>${e(labels.project)}: ${e(group.projectName)}</h2>
      <table>
        <thead><tr><th class="box"></th><th>${e(labels.item)}</th><th class="num">${e(labels.quantity)}</th><th>${e(labels.unit)}</th></tr></thead>
        <tbody>
          ${group.items.map((item) => `<tr>
            <td class="box"><span class="check"></span></td>
            <td>${e(item.material)}${item.store ? `<div class="store">${e(labels.store)}: ${e(item.store)}</div>` : ""}</td>
            <td class="num">${e(formatQty(item.quantity))}</td>
            <td>${e(item.unit)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </section>`).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  @page { margin: 36px; }
  body { font-family: Helvetica, Arial, sans-serif; color: #302F28; font-size: 13px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .meta { margin: 0 0 22px; color: #6B6355; line-height: 1.6; }
  .meta b { color: #302F28; }
  h2 { font-size: 15px; margin: 22px 0 8px; padding-bottom: 5px; border-bottom: 2px solid #302F28; }
  section { page-break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; color: #6B6355; text-transform: uppercase; padding: 6px 8px; }
  td { padding: 10px 8px; border-bottom: 1px solid #DFDAD0; vertical-align: middle; }
  .box { width: 28px; }
  .num { text-align: right; width: 80px; }
  .check { display: inline-block; width: 15px; height: 15px; border: 1.5px solid #302F28; border-radius: 3px; }
  .store { font-size: 11px; color: #6B6355; margin-top: 2px; }
</style></head>
<body>
  <h1>${e(labels.title)} #${e(poNumber)}</h1>
  <p class="meta"><b>${e(labels.date)}:</b> ${e(dateText)}<br /><b>${e(labels.preparedBy)}:</b> ${e(preparedBy)}</p>
  ${sections}
</body></html>`;
}
