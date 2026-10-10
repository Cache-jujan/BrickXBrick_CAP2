-- 029_tamper_alert_integrity.sql
-- F12: make tamper detection hard to hide.
--
-- Before: the scan only looked at 50 expenses with blockchainStatus =
-- 'Confirmed'; setting an expense to 'Pending' made the retry job write a
-- NEW hash of the changed data, and verification used the newest record;
-- deleting an alert row hid it for good; "resolve" only stamped a time.
--
-- This migration:
--   1. tamper_alerts keeps who resolved an alert, why, and whether the data
--      was later restored to its approved values. Resolved alerts stay listed.
--   2. Expenses.lastIntegrityCheckAt so the scan visits every secured
--      expense in turn (oldest check first), whatever its status says.
--   3. Guards (triggers): tamper_alerts can't be deleted and its detection
--      details can't be edited; a resolution can't be changed once written.
--      BlockchainLogs can't be edited or deleted, and an expense can be
--      secured on the chain only once.
--
-- The triggers stop the app and casual edits. Someone with full database
-- rights could still drop them, which is why the scan re-creates any alert
-- that is missing: the blockchain copy, not the database, is the proof.
-- For test-data cleanup only:  SET LOCAL brickxbrick.allow_audit_edit = 'on';
--
-- Safe to re-run.

-- 1. Alert resolution details
ALTER TABLE tamper_alerts ADD COLUMN IF NOT EXISTS resolvedBy UUID NULL REFERENCES users(userID);
ALTER TABLE tamper_alerts ADD COLUMN IF NOT EXISTS resolutionNote TEXT NULL;
ALTER TABLE tamper_alerts ADD COLUMN IF NOT EXISTS restoredAt TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_tamper_alerts_expense ON tamper_alerts(expenseID, recomputedHash);

-- 2. Round-robin integrity scan
ALTER TABLE Expenses ADD COLUMN IF NOT EXISTS lastIntegrityCheckAt TIMESTAMP NULL;

-- 3a. tamper_alerts guard
CREATE OR REPLACE FUNCTION tamper_alerts_guard() RETURNS trigger AS $$
BEGIN
  IF current_setting('brickxbrick.allow_audit_edit', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Tamper alerts cannot be deleted';
  END IF;
  IF NEW.expenseID IS DISTINCT FROM OLD.expenseID
     OR NEW.recomputedHash IS DISTINCT FROM OLD.recomputedHash
     OR NEW.onChainHash IS DISTINCT FROM OLD.onChainHash
     OR NEW.detectedAt IS DISTINCT FROM OLD.detectedAt THEN
    RAISE EXCEPTION 'The details of a tamper alert cannot be changed';
  END IF;
  IF OLD.resolvedAt IS NOT NULL AND (
       NEW.resolvedAt IS DISTINCT FROM OLD.resolvedAt
       OR NEW.resolvedBy IS DISTINCT FROM OLD.resolvedBy
       OR NEW.resolutionNote IS DISTINCT FROM OLD.resolutionNote) THEN
    RAISE EXCEPTION 'A tamper alert resolution cannot be changed';
  END IF;
  IF OLD.restoredAt IS NOT NULL AND NEW.restoredAt IS DISTINCT FROM OLD.restoredAt THEN
    RAISE EXCEPTION 'The restored time of a tamper alert cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tamper_alerts_guard ON tamper_alerts;
CREATE TRIGGER trg_tamper_alerts_guard
  BEFORE UPDATE OR DELETE ON tamper_alerts
  FOR EACH ROW EXECUTE FUNCTION tamper_alerts_guard();

-- 3b. BlockchainLogs guard: append-only, one approval record per expense
CREATE OR REPLACE FUNCTION blockchain_logs_guard() RETURNS trigger AS $$
BEGIN
  IF current_setting('brickxbrick.allow_audit_edit', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Blockchain log records cannot be changed or deleted';
  END IF;
  IF NEW.eventType = 'ExpenseApproved' AND EXISTS (
       SELECT 1 FROM BlockchainLogs
        WHERE expenseID = NEW.expenseID AND eventType = 'ExpenseApproved') THEN
    RAISE EXCEPTION 'This expense is already secured on the blockchain';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blockchain_logs_guard ON BlockchainLogs;
CREATE TRIGGER trg_blockchain_logs_guard
  BEFORE INSERT OR UPDATE OR DELETE ON BlockchainLogs
  FOR EACH ROW EXECUTE FUNCTION blockchain_logs_guard();
