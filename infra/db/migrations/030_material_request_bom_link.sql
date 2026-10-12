-- 030_material_request_bom_link.sql
-- T2a: a Material Request references an item from the project's approved BOM,
-- or is explicitly marked "Not in BOM" with a reason.
--
-- tickets.bomItemID already exists (migration 028). This adds the exception
-- path and two guards. Both guards hold for rows created before this migration
-- (bomItemID NULL, notInBom FALSE, reason NULL), so it applies cleanly to an
-- existing database. The "a Material Request must pick or mark not-in-BOM"
-- rule is enforced in the API, not here, to avoid rejecting older MR rows.
--
-- Safe to re-run.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS notInBom       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notInBomReason TEXT NULL;

-- A ticket can't be both on-BOM and off-BOM.
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_bom_exclusive;
ALTER TABLE tickets ADD CONSTRAINT tickets_bom_exclusive
  CHECK (NOT (bomItemID IS NOT NULL AND notInBom = TRUE));

-- If it's off-BOM, it needs a non-empty reason.
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_notinbom_reason;
ALTER TABLE tickets ADD CONSTRAINT tickets_notinbom_reason
  CHECK (notInBom = FALSE OR (notInBomReason IS NOT NULL AND length(trim(notInBomReason)) > 0));