-- 037_bom_client_agreement.sql
-- F2 (adviser item 5): purchases start only after the client agrees to the BOM.
--
-- The agreement itself happens OUTSIDE the system (on paper, at a meeting or by
-- email reply); the BOM comes in as Excel, so there is nothing to sign here.
-- What the system records, when the GM approves the BOM, is that it happened:
--   clientAgreedOn  the date the client agreed (not in the future)
--   clientAgreedBy  who agreed (the client's name)
--   agreementRef    optional reference, e.g. a contract number
-- Activation already requires an approved BOM, so no project can start buying
-- without these on record. Reopening the BOM clears them: the revised BOM needs
-- the client's agreement again.
--
-- The CHECK is NOT VALID so BOMs approved before this migration stay as they
-- are; every BOM approved from now on must carry the agreement details.
-- Safe to re-run.

ALTER TABLE boms ADD COLUMN IF NOT EXISTS clientAgreedOn DATE NULL;
ALTER TABLE boms ADD COLUMN IF NOT EXISTS clientAgreedBy VARCHAR(150) NULL;
ALTER TABLE boms ADD COLUMN IF NOT EXISTS agreementRef VARCHAR(100) NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boms_approved_needs_client_agreement') THEN
    ALTER TABLE boms
      ADD CONSTRAINT boms_approved_needs_client_agreement
      CHECK (status <> 'Approved' OR (clientAgreedOn IS NOT NULL AND clientAgreedBy IS NOT NULL))
      NOT VALID;
  END IF;
END $$;
