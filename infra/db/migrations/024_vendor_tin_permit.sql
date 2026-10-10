-- Idempotent: 019_vendor_master_bir_fields already adds these columns on a
-- fresh database, so plain ADD COLUMN failed there.
   ALTER TABLE VendorMasterList
     ADD COLUMN IF NOT EXISTS tin VARCHAR(20) NULL,
     ADD COLUMN IF NOT EXISTS birPermitNumber VARCHAR(20) NULL;