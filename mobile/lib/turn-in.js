// How the Turn In tab lists the day's receipts. Pure, so it is tested in Node
// (lib/sync/test/turn-in.test.mjs).
//
// A row is either a receipt still on this phone (queued while offline) or a scan on the
// server. Each has one state, which decides the chip and what a tap does:
//   waiting       on the phone, uploads when the signal is back
//   upload_failed the server refused the upload
//   reading       the server is reading the photo
//   failed        the server could not read it; type it in against the photo
//   review        read and ready for the Purchaser to check

export function trayRows(scans, queued) {
  const rows = [];

  for (const row of Array.isArray(queued) ? queued : []) {
    rows.push({
      key: `q:${row.scan_id}`,
      kind: "queued",
      state: row.sync_status === "REJECTED" ? "upload_failed" : "waiting",
      vendor: null,
      amount: null,
      trip: row.context?.kind === "trip",
      createdAt: row.created_at,
      queued: row,
    });
  }

  for (const scan of Array.isArray(scans) ? scans : []) {
    const amount = scan.result?.amount == null ? NaN : Number(scan.result.amount);
    rows.push({
      key: `s:${scan.scanID}`,
      kind: "scan",
      state: scan.status === "Scanning" ? "reading" : scan.status === "Failed" ? "failed" : "review",
      vendor: scan.status === "Ready" ? scan.result?.vendorName ?? null : null,
      amount: scan.status === "Ready" && Number.isFinite(amount) ? amount : null,
      // A petty cash receipt: it ends on the Petty cash screen instead of Check receipt.
      trip: scan.context?.kind === "trip",
      createdAt: scan.createdAt,
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
