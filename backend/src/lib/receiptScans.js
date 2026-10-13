// receiptScans.js — F6 background scanning (ReceiptScans table, migration 033).
//
// POST /receipts/scans stores the image, inserts a 'Scanning' row and answers
// at once; runScan() then OCRs in this same process and marks the row
// 'Ready' (with the draft) or 'Failed'. The user can leave or close the app.
//
// No job queue: a scan lives in this process. If the server restarts mid-scan
// the row would stay 'Scanning' forever, so a row older than STALE_AFTER_MS
// is reported (and saved) as Failed, and the user enters it manually against
// the image that was already stored.
//
// Deploy note: the work continues AFTER the HTTP response. That is fine on a
// normal Node host (Railway, a VM); on Cloud Run it needs CPU always
// allocated, or the scan is throttled once the response is sent.

const STALE_AFTER_MS = 3 * 60 * 1000;
const STALE_MESSAGE = "Reading this receipt took too long. Enter the details manually from the photo.";
const FAILED_MESSAGE = "Couldn't read this receipt. Enter the details manually from the photo.";
const LIST_DAYS = 7;
const LIST_LIMIT = 20;
const MAX_CONTEXT_BYTES = 4096;

const SCAN_COLUMNS = `
  scanid          AS "scanID",
  status,
  receiptimageurl AS "receiptImageURL",
  mimetype        AS "mimeType",
  context,
  result,
  errormessage    AS "errorMessage",
  createdat       AS "createdAt",
  completedat     AS "completedAt"
`;

/**
 * The app's resume context arrives as a multipart text field. Only a small
 * JSON object is kept; anything else is dropped (the scan still works, the
 * user just picks the ticket again).
 */
function parseContext(raw) {
  if (typeof raw !== "string" || raw.length === 0 || Buffer.byteLength(raw) > MAX_CONTEXT_BYTES) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function isStale(row, now = Date.now()) {
  return row.status === "Scanning" && now - new Date(row.createdAt).getTime() > STALE_AFTER_MS;
}

function createReceiptScans({ query, buildScanDraft }) {
  async function createScan({ userID, receiptImageURL, mimeType, context }) {
    const result = await query(
      `INSERT INTO ReceiptScans (submittedBy, receiptImageURL, mimeType, context)
       VALUES ($1, $2, $3, $4)
       RETURNING ${SCAN_COLUMNS}`,
      [userID, receiptImageURL, mimeType, context ? JSON.stringify(context) : null]
    );
    return result.rows[0];
  }

  // Never throws: whatever happens, the row leaves 'Scanning'.
  async function runScan(scanID, buffer, mimeType, receiptImageURL) {
    try {
      const draft = await buildScanDraft(buffer, mimeType, receiptImageURL);
      await query(
        `UPDATE ReceiptScans SET status = 'Ready', result = $2, completedAt = NOW()
          WHERE scanID = $1 AND status = 'Scanning'`,
        [scanID, JSON.stringify(draft)]
      );
    } catch (err) {
      console.error(`Background scan ${scanID} failed:`, err);
      try {
        await query(
          `UPDATE ReceiptScans SET status = 'Failed', errorMessage = $2, completedAt = NOW()
            WHERE scanID = $1 AND status = 'Scanning'`,
          [scanID, FAILED_MESSAGE]
        );
      } catch (updateErr) {
        // Left 'Scanning'; the stale rule reports it as Failed later.
        console.error(`Could not mark scan ${scanID} as Failed:`, updateErr);
      }
    }
  }

  // A 'Scanning' row too old to still be running is closed out as Failed.
  async function settle(row) {
    if (!isStale(row)) return row;
    await query(
      `UPDATE ReceiptScans SET status = 'Failed', errorMessage = $2, completedAt = NOW()
        WHERE scanID = $1 AND status = 'Scanning'`,
      [row.scanID, STALE_MESSAGE]
    );
    return { ...row, status: "Failed", errorMessage: STALE_MESSAGE };
  }

  async function getScan(scanID, userID) {
    const result = await query(
      `SELECT ${SCAN_COLUMNS} FROM ReceiptScans
        WHERE scanID = $1 AND submittedBy = $2 AND dismissedAt IS NULL`,
      [scanID, userID]
    );
    return result.rows[0] ? settle(result.rows[0]) : null;
  }

  async function listScans(userID) {
    const result = await query(
      `SELECT ${SCAN_COLUMNS} FROM ReceiptScans
        WHERE submittedBy = $1 AND dismissedAt IS NULL
          AND createdAt > NOW() - ($2 || ' days')::interval
        ORDER BY createdAt DESC
        LIMIT ${LIST_LIMIT}`,
      [userID, String(LIST_DAYS)]
    );
    return Promise.all(result.rows.map(settle));
  }

  // Hides the scan from the list (after the expense is submitted, or when
  // the user discards it). The row is kept.
  async function dismissScan(scanID, userID) {
    const result = await query(
      `UPDATE ReceiptScans SET dismissedAt = NOW()
        WHERE scanID = $1 AND submittedBy = $2 AND dismissedAt IS NULL`,
      [scanID, userID]
    );
    return result.rowCount > 0;
  }

  return { createScan, runScan, getScan, listScans, dismissScan };
}

module.exports = { createReceiptScans, parseContext, isStale, STALE_AFTER_MS, STALE_MESSAGE, FAILED_MESSAGE };
