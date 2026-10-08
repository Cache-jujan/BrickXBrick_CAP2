-- Fix two ATP numbers seeded by 016_vendor_master_bir_fields.sql.
--
-- A BIR ATP number is 19 characters: region code (080) + "AU" + 4-digit
-- year + 10-digit serial. Two seed rows have 18 (one zero dropped from the
-- serial). The receipts in backend/scripts/receipt-img show the full value:
--   receipt (1).jpg  Padeena Enterprises  Authority to Print No.: 080AU20230000001328
--   receipt (5).jpg  Krislee Enterprises  OCN: 080AU20260000000567
-- Because /receipts/scan lets the vendor list override OCR, the short values
-- were overwriting a correct OCR reading with a wrong one.
--
-- Only rows still holding the bad seed value are touched, so re-running this
-- (or running it after someone already corrected the row) is a no-op.

UPDATE VendorMasterList
   SET birPermitNumber = '080AU20230000001328'
 WHERE LOWER(vendorName) = 'padeena enterprises'
   AND birPermitNumber = '080AU2023000001328';

UPDATE VendorMasterList
   SET birPermitNumber = '080AU20260000000567'
 WHERE LOWER(vendorName) = 'krislee enterprises'
   AND birPermitNumber = '080AU2026000000567';
