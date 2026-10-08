-- infra/db/migrations/013_ticket_procurement_fields.sql
--
-- F4 ticket schema extension for F9 ticket-receipt comparison.
-- Material Request tickets can now carry structured procurement context;
-- existing and non-procurement tickets remain valid because these fields are
-- nullable.

ALTER TABLE Tickets
  ADD COLUMN IF NOT EXISTS materialType VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS quantity DECIMAL(10,2) NULL,
  ADD COLUMN IF NOT EXISTS vendorName VARCHAR(200) NULL;

ALTER TABLE Tickets
  DROP CONSTRAINT IF EXISTS tickets_quantity_check;

ALTER TABLE Tickets
  ADD CONSTRAINT tickets_quantity_check
  CHECK (quantity IS NULL OR quantity > 0);