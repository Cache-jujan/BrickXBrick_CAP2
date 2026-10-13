-- 033_receipt_scans.sql
-- F6: background receipt scanning. The app uploads a receipt and gets a
-- scanID back at once; OCR runs on the server and the row turns Ready (with
-- the expense draft) or Failed. The user can leave or close the app and pick
-- the receipt up later from "Scanned receipts".
--
-- context: what the app needs to resume (single/split mode, chosen ticket).
-- It is only ever read back by the same user; the server doesn't trust it.
-- result:  the same draft POST /receipts/scan returns.
--
-- Times are TIMESTAMPTZ: the API compares them with the server clock
-- (stale-scan check), which must not depend on the server's time zone.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS ReceiptScans (
    scanID          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submittedBy     UUID NOT NULL REFERENCES Users(userID),
    status          VARCHAR(20) NOT NULL DEFAULT 'Scanning' CHECK (status IN ('Scanning', 'Ready', 'Failed')),
    receiptImageURL TEXT NOT NULL,
    mimeType        VARCHAR(50) NOT NULL,
    context         JSONB NULL,
    result          JSONB NULL,
    errorMessage    TEXT NULL,
    createdAt       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completedAt     TIMESTAMPTZ NULL,
    dismissedAt     TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS receiptscans_submittedby_createdat_idx
    ON ReceiptScans (submittedBy, createdAt DESC);
