-- 032_fraudflag_receipt_adjustment.sql
-- F6/F9: the receipt review screen lets a Purchaser close a small gap
-- between the line items and the receipt total with an "Adjustment" line
-- (rounding, an unlisted discount or VAT) instead of getting stuck.
-- Every such expense is flagged so a PM looks at it before approving.
--
-- Safe to re-run.

ALTER TABLE FraudFlags DROP CONSTRAINT IF EXISTS fraudflags_flagtype_check;
ALTER TABLE FraudFlags ADD CONSTRAINT fraudflags_flagtype_check
  CHECK (flagType IN ('BIR_Duplicate', 'Vendor_Validation', 'Ticket_Mismatch', 'Receipt_Adjustment'));
