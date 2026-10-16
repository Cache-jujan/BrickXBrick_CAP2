-- F11: report_events + blockchain anchoring of generated reports.
--
-- A hash on chain proves nothing unless the hashed content is stored, so every
-- exported report is saved here (totals included) and its hash is anchored in
-- BlockchainLogs as a ReportGenerated event.
--
-- BlockchainLogs is append-only (migration 029): the anchor only INSERTs a row.
-- The Pending -> Confirmed status lives on report_events, never on the log row.
-- The eventType CHECK from 001 already allows 'ReportGenerated'.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS report_events (
    reportId     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    generatedBy  UUID NOT NULL REFERENCES users(userID),
    projectIds   UUID[] NOT NULL,
    periodFrom   DATE NOT NULL,
    periodTo     DATE NOT NULL,
    generatedAt  TIMESTAMP NOT NULL,
    totals       JSONB NOT NULL,
    payloadHash  VARCHAR(64) NOT NULL,
    anchorStatus VARCHAR(20) NOT NULL DEFAULT 'Pending'
                   CHECK (anchorStatus IN ('Pending', 'Confirmed')),
    CHECK (periodTo >= periodFrom)
);

-- A log row is now about an expense OR a report, never both, never neither.
ALTER TABLE BlockchainLogs ALTER COLUMN expenseID DROP NOT NULL;
ALTER TABLE BlockchainLogs ADD COLUMN IF NOT EXISTS reportId UUID NULL REFERENCES report_events(reportId);

ALTER TABLE BlockchainLogs DROP CONSTRAINT IF EXISTS blockchainlogs_one_subject;
ALTER TABLE BlockchainLogs ADD CONSTRAINT blockchainlogs_one_subject
  CHECK (num_nonnulls(expenseID, reportId) = 1);

-- A report is anchored at most once (a retry must not double-write).
CREATE UNIQUE INDEX IF NOT EXISTS blockchainlogs_one_anchor_per_report
  ON BlockchainLogs (reportId) WHERE reportId IS NOT NULL;
