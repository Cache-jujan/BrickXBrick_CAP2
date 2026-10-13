-- 031_ticket_unit.sql
-- Adds a unit of measure to procurement tickets (Material Request / Work Item).
--
-- For an on-BOM Material Request the unit is derived server-side from the BOM
-- item's own unit (BOMItems.unit, migration 028); for a Not-in-BOM Material
-- Request or a Work Item the creator picks one. Nullable because rows created
-- before this migration — and Report tickets — have no unit.
--
-- VARCHAR(30) matches BOMItems.unit so a derived unit always fits.
--
-- Safe to re-run.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS unit VARCHAR(30) NULL;