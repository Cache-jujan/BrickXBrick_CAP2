-- 028_bill_of_materials.sql
-- F2: the project's Bill of Materials (BOM).
--
-- Client (Oct 2026): the BOM is signed and sealed by the architect and the
-- owner before construction and "is the basis for every purchase and
-- mobilization". It always arrives as an Excel file in the company's format.
-- The price given to the client is the BOM total.
--
-- What this adds:
--   1. BOMs         one per project; Draft while the GM reviews it, Approved
--                   once locked. Approving it is required before activation.
--   2. BOMSections  STRUCTURAL, PLUMBING, ... with the section's labor
--                   (a rate of the material cost, a fixed amount, or included
--                   in the item prices) and the figures as written in the file.
--   3. BOMItems     one row per material, units stored exactly as written.
--   4. Tickets.bomItemID  (used by the next patch: Material Requests pick an
--                   item from the approved BOM). Nullable; nothing uses it yet.
--   5. Notification types BOMApproved and BOMReopened.
--
-- Not stored on purpose: the header block (project, location, owner, address)
-- and the footer (prepared/approved by, registration numbers). The importer
-- skips them.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS boms (
  bomID           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  projectID       UUID NOT NULL UNIQUE REFERENCES projects(projectID),
  status          VARCHAR(20) NOT NULL DEFAULT 'Draft'
                    CHECK (status IN ('Draft', 'Approved')),
  sourceFileName  VARCHAR(255) NULL,
  statedTotal     DECIMAL(15,2) NULL CHECK (statedTotal IS NULL OR statedTotal >= 0),
  createdBy       UUID NOT NULL REFERENCES users(userID),
  createdAt       TIMESTAMP NOT NULL DEFAULT NOW(),
  updatedBy       UUID NULL REFERENCES users(userID),
  updatedAt       TIMESTAMP NOT NULL DEFAULT NOW(),
  approvedBy      UUID NULL REFERENCES users(userID),
  approvedAt      TIMESTAMP NULL,
  reopenedBy      UUID NULL REFERENCES users(userID),
  reopenedAt      TIMESTAMP NULL,
  revisionNote    TEXT NULL,
  CONSTRAINT boms_approved_fields CHECK (
    status <> 'Approved' OR (approvedBy IS NOT NULL AND approvedAt IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS bomSections (
  sectionID            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bomID                UUID NOT NULL REFERENCES boms(bomID) ON DELETE CASCADE,
  name                 VARCHAR(150) NOT NULL,
  subheading           VARCHAR(200) NULL,
  sortOrder            INTEGER NOT NULL,
  -- Labor is one of: a rate of the section's material cost (e.g. 0.5),
  -- a fixed amount, or included in the item prices (Glass Walls and Doors).
  laborRate            DECIMAL(6,4) NULL CHECK (laborRate IS NULL OR laborRate >= 0),
  laborAmount          DECIMAL(15,2) NULL CHECK (laborAmount IS NULL OR laborAmount >= 0),
  laborIncludedInItems BOOLEAN NOT NULL DEFAULT FALSE,
  statedMaterialTotal  DECIMAL(15,2) NULL,
  statedLaborAmount    DECIMAL(15,2) NULL,
  CONSTRAINT bomsections_labor_one_mode CHECK (
    (laborRate IS NULL OR laborAmount IS NULL)
    AND (NOT laborIncludedInItems OR (laborRate IS NULL AND laborAmount IS NULL))
  )
);

CREATE INDEX IF NOT EXISTS idx_bomsections_bom ON bomSections(bomID, sortOrder);

CREATE TABLE IF NOT EXISTS bomItems (
  bomItemID     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sectionID     UUID NOT NULL REFERENCES bomSections(sectionID),
  sortOrder     INTEGER NOT NULL,
  description   VARCHAR(200) NOT NULL CHECK (LENGTH(TRIM(description)) > 0),
  quantity      DECIMAL(12,2) NOT NULL CHECK (quantity > 0),
  unit          VARCHAR(30) NOT NULL CHECK (LENGTH(TRIM(unit)) > 0),
  unitCost      DECIMAL(12,2) NOT NULL CHECK (unitCost >= 0),
  estimatedCost DECIMAL(15,2) GENERATED ALWAYS AS (ROUND(quantity * unitCost, 2)) STORED
);

CREATE INDEX IF NOT EXISTS idx_bomitems_section ON bomItems(sectionID, sortOrder);

-- 4. Link a Material Request to the BOM item it buys (next patch).
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS bomItemID UUID NULL REFERENCES bomItems(bomItemID);
CREATE INDEX IF NOT EXISTS idx_tickets_bomitem ON tickets(bomItemID) WHERE bomItemID IS NOT NULL;

-- 5. Notifications (keeps every existing type)
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'ScheduleVarianceAlert', 'ExpenseRejected', 'TamperAlert', 'TaskAssigned',
    'ProjectAssigned', 'ProjectActivated', 'BOMApproved', 'BOMReopened'
  ));
