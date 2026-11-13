-- The Vendor Master List now holds trusted vendors only. A vendor that is not
-- on the list is screened as "not found" and goes to the Project Manager, so a
-- separate Approved/Flagged status adds nothing.
--
-- Flagged rows were not trusted, so they are removed rather than turned into
-- trusted ones. Receipts keep the vendor name as text (Expenses.vendorName),
-- so old expenses are not affected.

DELETE FROM VendorMasterList WHERE approvalStatus = 'Flagged';

-- Dropping the column also drops its CHECK constraint.
ALTER TABLE VendorMasterList DROP COLUMN IF EXISTS approvalStatus;
