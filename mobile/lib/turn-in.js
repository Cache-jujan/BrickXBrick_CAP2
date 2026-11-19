// How the Turn In tab lists the day's receipts. Pure, so it is tested in Node
// (lib/sync/test/turn-in.test.mjs).
//
// A row is either a receipt still on this phone (queued while offline) or a scan on the
// server. Each has one state, which decides the chip and what a tap does:
//   waiting       on the phone, uploads when the signal is back
//   upload_failed the server refused the upload
//   reading       the server is reading the photo
//   failed        the server could not read it; type it in against the photo
//   not_receipt   the file is not a receipt; nothing to type in
//   review        read and ready for the Purchaser to check
//
// Every row also says what it was snapped for, when the app knows:
//   request  the request it was opened from (null for "snap now" receipts)
//   project  that request's project, or the projects a "snap now" receipt was scoped to
//   fileName the photo or PDF that was sent

/** What a receipt was snapped for, from the context saved with it. */
export function snappedFor(context) {
  const ticket = context?.ticket ?? null;
  const scoped = Array.isArray(context?.projectNames) && context.projectNames.length ? context.projectNames.join(", ") : null;
  return { request: ticket?.subject ?? null, project: ticket?.projectName ?? scoped };
}

export function trayRows(scans, queued) {
  const rows = [];

  for (const row of Array.isArray(queued) ? queued : []) {
    rows.push({
      key: `q:${row.scan_id}`,
      kind: "queued",
      state: row.sync_status === "REJECTED" ? "upload_failed" : "waiting",
      vendor: null,
      amount: null,
      createdAt: row.created_at,
      fileName: row.file_name ?? null,
      ...snappedFor(row.context),
      queued: row,
    });
  }

  for (const scan of Array.isArray(scans) ? scans : []) {
    const amount = scan.result?.amount == null ? NaN : Number(scan.result.amount);
    rows.push({
      key: `s:${scan.scanID}`,
      kind: "scan",
      state: scan.status === "Scanning" ? "reading" : scan.status === "Failed" ? (scan.result?.notReceipt ? "not_receipt" : "failed") : "review",
      vendor: scan.status === "Ready" ? scan.result?.vendorName ?? null : null,
      amount: scan.status === "Ready" && Number.isFinite(amount) ? amount : null,
      createdAt: scan.createdAt,
      fileName: scan.context?.fileName ?? null,
      ...snappedFor(scan.context),
      scan,
    });
  }

  // Newest first.
  return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** How many receipts are in the tray, and the total of those already read. */
export function traySummary(rows) {
  return { count: rows.length, total: rows.reduce((sum, row) => sum + (row.amount ?? 0), 0) };
}

/** States where the Purchaser has to do something: open the row, fix it or remove it. */
export const needsAttention = (state) => state !== "waiting" && state !== "reading";
