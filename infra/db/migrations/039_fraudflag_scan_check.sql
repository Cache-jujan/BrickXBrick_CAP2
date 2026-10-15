-- 037_fraudflag_scan_check.sql
-- F9: the server compares what was submitted with what its own OCR
-- read from the same receipt image (ReceiptScans.result).
--   Receipt_Edited  a value or line was changed (or typed into a blank) after
--                   the scan, e.g. "Heavy duty plug" renamed to "Cement"
--   Manual_Entry    the scan could not read the receipt, so every value was
--                   typed by the submitter
-- Both route the expense to a PM; neither blocks the submit.
--
-- Safe to re-run.

ALTER TABLE FraudFlags DROP CONSTRAINT IF EXISTS fraudflags_flagtype_check;
ALTER TABLE FraudFlags ADD CONSTRAINT fraudflags_flagtype_check
  CHECK (flagType IN ('BIR_Duplicate', 'Vendor_Validation', 'Ticket_Mismatch', 'Receipt_Adjustment',
                      'Receipt_Edited', 'Manual_Entry'));

-- The scan comparison looks a scan up by the receipt image it read.
CREATE INDEX IF NOT EXISTS receiptscans_receiptimageurl_idx
    ON ReceiptScans (receiptImageURL);
