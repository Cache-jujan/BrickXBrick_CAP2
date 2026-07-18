-- 007_receipt_allocations.sql
-- Matches Data Dictionary Table 36 (ReceiptAllocations).
-- This is F8's primary table.

CREATE TABLE IF NOT EXISTS receipt_allocations (
    allocation_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id         UUID NOT NULL REFERENCES expenses(expense_id),
    project_id         UUID NOT NULL REFERENCES projects(project_id),
    allocated_amount   DECIMAL(12,2) NOT NULL CHECK (allocated_amount > 0),
    common_receipt_id  VARCHAR(100) NOT NULL,
    created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_allocations_common_receipt ON receipt_allocations(common_receipt_id);
CREATE INDEX IF NOT EXISTS idx_allocations_project ON receipt_allocations(project_id);
