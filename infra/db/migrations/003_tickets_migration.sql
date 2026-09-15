-- infra/db/migrations/003_ticket_acknowledge.sql

ALTER TABLE Tickets DROP CONSTRAINT tickets_status_check;
ALTER TABLE Tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('Pending', 'Acknowledged', 'Resolved', 'Rejected'));

ALTER TABLE Tickets ADD COLUMN acknowledgedAt TIMESTAMP NULL
  CHECK (acknowledgedAt IS NULL OR acknowledgedAt >= createdAt);