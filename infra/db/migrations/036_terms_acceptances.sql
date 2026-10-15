-- 036_terms_acceptances.sql
-- Terms of Use and Privacy Notice acceptance (Data Privacy Act, RA 10173).
--
-- One row each time a user accepts a version of the terms: who, which
-- version, when, and from what IP address / device. The text itself lives in
-- backend/src/lib/legalTerms.js (TERMS_VERSION).
--
-- Rows are proof of acceptance, so they can't be edited or deleted (same
-- guard style as migration 029). For test-data cleanup only:
--   SET LOCAL brickxbrick.allow_audit_edit = 'on';
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS terms_acceptances (
  acceptanceID  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  userID        UUID NOT NULL REFERENCES users(userID),
  termsVersion  VARCHAR(20) NOT NULL,
  acceptedAt    TIMESTAMP NOT NULL DEFAULT NOW(),
  ipAddress     VARCHAR(64) NULL,
  userAgent     VARCHAR(300) NULL,
  CONSTRAINT terms_acceptances_once_per_version UNIQUE (userID, termsVersion)
);

CREATE OR REPLACE FUNCTION terms_acceptances_guard() RETURNS trigger AS $$
BEGIN
  IF current_setting('brickxbrick.allow_audit_edit', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Terms acceptance records cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_terms_acceptances_guard ON terms_acceptances;
CREATE TRIGGER trg_terms_acceptances_guard
  BEFORE UPDATE OR DELETE ON terms_acceptances
  FOR EACH ROW EXECUTE FUNCTION terms_acceptances_guard();
