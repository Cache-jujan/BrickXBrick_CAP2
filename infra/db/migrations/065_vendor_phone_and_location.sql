-- Vendor Master List: contact phone number, and a location for the seeded vendors.
--
-- DEMO DATA. The three seeded vendors have no phone or Consolacion address we could
-- verify, so the phone numbers below are demo numbers and the locations are
-- placeholder places in Consolacion, Cebu. Replace them from the System
-- Administrator's Vendor Master List page once the real details are known.
--
-- Idempotent: the column is added only if missing, and a phone or location is
-- filled in only where the vendor does not already have one, so anything an
-- administrator has typed is never overwritten.

ALTER TABLE VendorMasterList
  ADD COLUMN IF NOT EXISTS phone VARCHAR(30) NULL;

COMMENT ON COLUMN VendorMasterList.phone IS 'Vendor contact phone number (free text, digits plus + ( ) - and spaces)';

UPDATE VendorMasterList v
   SET location = COALESCE(NULLIF(BTRIM(v.location), ''), seed.location),
       phone    = COALESCE(NULLIF(BTRIM(v.phone), ''), seed.phone)
  FROM (
    VALUES
      ('Padeena Enterprises',                 'Cebu North Road, Brgy. Lamac, Consolacion, Cebu',               '+63 917 555 0101'),
      ('Cebu Atlantic Hardware (Franchisee)', 'Cebu North Road, Brgy. Poblacion Occidental, Consolacion, Cebu', '+63 917 555 0102'),
      ('Krislee Enterprises',                 'Brgy. Cansaga, Consolacion, Cebu',                              '+63 917 555 0103')
  ) AS seed(vendorName, location, phone)
 WHERE LOWER(v.vendorName) = LOWER(seed.vendorName);
