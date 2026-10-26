-- 052_fraudflag_screening_failed.sql
-- F9: if automatic screening throws after an expense has been saved, the
-- backend now records a Screening_Failed flag instead of returning a 500 or
-- silently leaving the expense unflagged. The flag routes the expense to the
-- PM's review queue with a "review manually" reason.
--
-- Safe to re-run.

ALTER TABLE FraudFlags DROP CONSTRAINT IF EXISTS fraudflags_flagtype_check;
ALTER TABLE FraudFlags ADD CONSTRAINT fraudflags_flagtype_check
  CHECK (flagType IN ('BIR_Duplicate', 'Vendor_Validation', 'Ticket_Mismatch', 'Receipt_Adjustment',
                      'Receipt_Edited', 'Manual_Entry', 'Screening_Failed'));