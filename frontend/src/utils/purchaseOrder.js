// The printable Purchase Order. The page itself (header, per-project tables, printable checkboxes) is the
// same code the phone app uses (shared/purchase-order.js), so both print the same document.
// Grouping uses this app's own groupByProject, so the PO always matches the project grouping on screen.
import { groupByProject } from "./openRequests";
import { buildPurchaseOrder as build, renderPurchaseOrderHtml } from "../../../shared/purchase-order.js";

/** What to buy per project, from the open requests. Only material, quantity, unit, project and store are read (never budgets). */
export function buildPurchaseOrder(requests) {
  return build(requests, (open) =>
    groupByProject(open).map((group) => ({ projectId: group.projectId, projectName: group.projectName, items: group.requests }))
  );
}

export { renderPurchaseOrderHtml };

/**
 * Opens the browser's print dialog for a page of HTML, through a hidden frame so the app itself is not printed.
 * The user prints it or picks "Save as PDF". Resolves once the dialog has been opened.
 */
export function printHtml(html) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      frame.remove();
    };
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        remove();
        reject(new Error("Could not open the print frame"));
        return;
      }
      win.onafterprint = remove;
      // Some browsers never report the dialog closing, so the frame is dropped after a while regardless.
      setTimeout(remove, 120000);
      try {
        win.focus();
        win.print();
        resolve();
      } catch (error) {
        remove();
        reject(error);
      }
    };
    document.body.appendChild(frame);
    frame.srcdoc = html;
  });
}
