-- Vendor Master List tax identity fields.
-- Keep OR/SI (Expenses.birNumber) on each receipt; OR/SI belongs to the receipt,
-- while TIN and BIR Permit/PTU/ATP belong to the vendor.
ALTER TABLE VendorMasterList
  ADD COLUMN IF NOT EXISTS tin VARCHAR(20),
  ADD COLUMN IF NOT EXISTS birPermitType VARCHAR(20),
  ADD COLUMN IF NOT EXISTS birPermitNumber VARCHAR(50);

ALTER TABLE VendorMasterList
  DROP CONSTRAINT IF EXISTS vendor_master_bir_permit_type_check;

ALTER TABLE VendorMasterList
  ADD CONSTRAINT vendor_master_bir_permit_type_check
  CHECK (birPermitType IS NULL OR birPermitType IN ('Permit', 'PTU', 'ATP'));

-- Remove only the synthetic records from the previous test-only version of
-- this migration, if that version was already applied.
DELETE FROM VendorMasterList
 WHERE LOWER(vendorName) IN (
   'demo hardware supply',
   'sample builders depot',
   'mock home center'
 );

-- Verified vendor master records supplied for the receipt test set.
-- Receipt 3 is intentionally not included because its store name, TIN, and
-- ATP/permit number were not visible/readable.
-- Re-running this migration updates these rows rather than duplicating them.
INSERT INTO VendorMasterList
  (addedBy, vendorName, location, tin, birPermitType, birPermitNumber, approvalStatus)
SELECT admin.userID, seed.vendorName, seed.location, seed.tin, seed.birPermitType, seed.birPermitNumber, 'Approved'
FROM (SELECT userID FROM Users WHERE role = 'System Administrator' AND status = 'Active' LIMIT 1) admin
CROSS JOIN (
  VALUES
    ('Padeena Enterprises', NULL, '180-400-144-00000', 'ATP', '080AU2023000001328'),
    ('Cebu Atlantic Hardware (Franchisee)', NULL, '235-777-645-00000', 'ATP', '080AU20250000013069'),
    ('Krislee Enterprises', NULL, '135-507-978-00000', 'ATP', '080AU2026000000567')
) AS seed(vendorName, location, tin, birPermitType, birPermitNumber)
ON CONFLICT (vendorName) DO UPDATE SET
  location = EXCLUDED.location,
  tin = EXCLUDED.tin,
  birPermitType = EXCLUDED.birPermitType,
  birPermitNumber = EXCLUDED.birPermitNumber,
  approvalStatus = 'Approved';

COMMENT ON COLUMN VendorMasterList.tin IS 'Vendor TIN; verified master data, not the receipt OR/SI number';
COMMENT ON COLUMN VendorMasterList.birPermitType IS 'Vendor BIR authority type: Permit, PTU, or ATP';
COMMENT ON COLUMN VendorMasterList.birPermitNumber IS 'Vendor BIR permit/PTU/ATP number';
