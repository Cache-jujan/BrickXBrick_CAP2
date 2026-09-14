-- infra/db/migrations/009_expenses_bir_lineitems.sql

-- Closes two schema gaps flagged against UC-06-01 / UC-07-01 / F9 Layer 1:
--
-- 1. tin / birPermitNumber were never persisted. birNumber (Table 35) only
--    ever covered OR/SI. F9 Layer 1's duplicate check requires the full
--    TIN + BIR Permit Number + OR/SI combination, and F7/UC-07-01 requires
--    checking all three fields — so both were unbuildable without this.
--
-- 2. lineItems was extracted by F6 OCR (UC-06-01 step 4) and editable in the
--    F6 review screen, but had no column to land in on submission — data
--    was silently dropped between the app and Postgres. Shape matches the
--    offlineExpenseQueue SQLite definition (Table 27):
--    [{ "description": string, "amount": number }]

ALTER TABLE Expenses
  ADD COLUMN tin VARCHAR(20) NULL,
  ADD COLUMN birPermitNumber VARCHAR(20) NULL,
  ADD COLUMN lineItems JSONB NULL;
