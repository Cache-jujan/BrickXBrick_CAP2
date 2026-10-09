-- Store the Site Manager's requested amount and the Project Manager's
-- confirmed/adjusted allocation on Material Request tickets.
ALTER TABLE Tickets
  ADD COLUMN IF NOT EXISTS requestedBudget DECIMAL(12,2) NULL
    CHECK (requestedBudget IS NULL OR requestedBudget >= 0),
  ADD COLUMN IF NOT EXISTS approvedBudget DECIMAL(12,2) NULL
    CHECK (approvedBudget IS NULL OR approvedBudget >= 0);
