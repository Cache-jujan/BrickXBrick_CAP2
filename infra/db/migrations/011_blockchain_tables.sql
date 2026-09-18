-- infra/db/migrations/010_blockchain_tables.sql
-- BlockchainLogs and Expenses.approvedBy already exist from
-- 001_initial_schema.sql (Table 38). This migration only adds what's
-- actually missing for F12 to work end-to-end:
--   1. tamper_alerts table (referenced in the manuscript, never built)
--   2. a default on BlockchainLogs.timestamp, since it's NOT NULL with
--      no default and the app's INSERT statements don't set it
--   3. Expenses.blockchainStatus, so the app can track per-expense state
--      (None | Pending | Confirmed | TamperDetected)

CREATE TABLE IF NOT EXISTS tamper_alerts (
    alertID          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expenseID        UUID NOT NULL REFERENCES Expenses(expenseID),
    recomputedHash   VARCHAR(100) NOT NULL,
    onChainHash      VARCHAR(100) NOT NULL,
    detectedAt       TIMESTAMP NOT NULL DEFAULT NOW(),
    resolvedAt       TIMESTAMP NULL,
    notifiedSysAdmin BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE BlockchainLogs ALTER COLUMN timestamp SET DEFAULT NOW();

ALTER TABLE Expenses
  ADD COLUMN IF NOT EXISTS blockchainStatus VARCHAR(20) NOT NULL DEFAULT 'None';