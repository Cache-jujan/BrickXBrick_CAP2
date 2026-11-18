-- 063_contracts_and_client_payments.sql
-- F2: the construction contract, and the client's payments against it.
--
-- Flow (agreed with the team after the pilot with the contractor):
--   BOM approved (price agreed) -> contract recorded -> project activated.
-- The contract is the signed agreement between the owner (client) and the
-- contractor. It is NOT the spending budget: the project budget stays the
-- approved BOM total plus the escalation allowance (routes/bom.js). The
-- contract amount is what the client pays; it normally equals the agreed price.
--
-- projectContracts  one row per project. A row exists only once the GM has
--                   reviewed and confirmed the details.
--   downPaymentPercent / retentionPercent are stored as percentages (20 = 20%)
--   because they differ per contract (the pilot contractor uses 20%, the
--   sample contract 40%). Defaults: 20% down payment, 10% retention.
--   The contract FILE is deliberately not stored: the R2 bucket is public
--   (lib/r2.js) and a contract holds the client's name and money terms.
--
-- clientPayments    money received from the client, one row per payment.
--   kind  Down Payment | Progress Billing | Retention
--   workDonePercent  the project's work done when a progress billing was made
--                    (billing follows progress, it is not a fixed schedule)
--   A payment is never edited or deleted. A wrong entry is VOIDED with a
--   reason, so the record stays complete (voidedBy/voidedAt/voidReason).
--   Only one live Down Payment and one live Retention per contract.
--
-- Existing projects are untouched: the contract is required to ACTIVATE a
-- project (routes/projects.js), so already-active demo projects keep working
-- and the GM can add their contract at any time.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS projectContracts (
  contractID           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projectID            UUID NOT NULL UNIQUE REFERENCES projects(projectID),
  contractRef          VARCHAR(100) NULL,
  contractDate         DATE NOT NULL,
  ownerName            VARCHAR(150) NOT NULL,
  contractorName       VARCHAR(150) NOT NULL,
  contractorRep        VARCHAR(150) NULL,
  contractorAddress    VARCHAR(255) NULL,
  scope                VARCHAR(255) NULL,
  siteLocation         VARCHAR(255) NULL,
  contractAmount       DECIMAL(15,2) NOT NULL CHECK (contractAmount > 0),
  downPaymentPercent   DECIMAL(5,2) NOT NULL DEFAULT 20
                         CHECK (downPaymentPercent >= 0 AND downPaymentPercent <= 100),
  retentionPercent     DECIMAL(5,2) NOT NULL DEFAULT 10
                         CHECK (retentionPercent >= 0 AND retentionPercent <= 100),
  durationWorkingDays  INT NULL CHECK (durationWorkingDays IS NULL OR durationWorkingDays > 0),
  warrantyMonths       INT NULL CHECK (warrantyMonths IS NULL OR warrantyMonths > 0),
  sourceFileName       VARCHAR(255) NULL,
  createdBy            UUID NOT NULL REFERENCES users(userID),
  createdAt            TIMESTAMP NOT NULL DEFAULT NOW(),
  updatedBy            UUID NULL REFERENCES users(userID),
  updatedAt            TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT projectcontracts_percent_total CHECK (downPaymentPercent + retentionPercent <= 100)
);

CREATE TABLE IF NOT EXISTS clientPayments (
  paymentID        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractID       UUID NOT NULL REFERENCES projectContracts(contractID),
  projectID        UUID NOT NULL REFERENCES projects(projectID),
  kind             VARCHAR(20) NOT NULL
                     CHECK (kind IN ('Down Payment', 'Progress Billing', 'Retention')),
  amount           DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  receivedOn       DATE NOT NULL,
  referenceNo      VARCHAR(100) NULL,
  workDonePercent  DECIMAL(5,2) NULL
                     CHECK (workDonePercent IS NULL OR (workDonePercent >= 0 AND workDonePercent <= 100)),
  note             VARCHAR(500) NULL,
  recordedBy       UUID NOT NULL REFERENCES users(userID),
  recordedAt       TIMESTAMP NOT NULL DEFAULT NOW(),
  voidedBy         UUID NULL REFERENCES users(userID),
  voidedAt         TIMESTAMP NULL,
  voidReason       VARCHAR(500) NULL,
  CONSTRAINT clientpayments_void_fields CHECK (
    (voidedAt IS NULL AND voidedBy IS NULL AND voidReason IS NULL)
    OR (voidedAt IS NOT NULL AND voidedBy IS NOT NULL AND voidReason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS clientpayments_project_idx ON clientPayments (projectID, receivedOn);

CREATE UNIQUE INDEX IF NOT EXISTS clientpayments_one_down_payment
  ON clientPayments (contractID) WHERE kind = 'Down Payment' AND voidedAt IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS clientpayments_one_retention
  ON clientPayments (contractID) WHERE kind = 'Retention' AND voidedAt IS NULL;
