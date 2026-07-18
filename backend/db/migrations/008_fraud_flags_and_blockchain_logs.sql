-- 008_fraud_flags_and_blockchain_logs.sql
-- These two tables belong to F9 (Multi-Layer Expense Screening) and F12
-- (Blockchain Audit Trail) respectively - NOT part of your F6/F7/F8 scope.
-- They're created now purely so expense-side code can compile against a
-- complete schema and so F8's "blockchain hook" has a real table to write
-- a placeholder row into. Do not build F9/F12 business logic here.

CREATE TABLE IF NOT EXISTS fraud_flags (
    flag_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id       UUID NOT NULL REFERENCES expenses(expense_id),
    reviewed_by      UUID REFERENCES users(user_id),
    flagged_by       VARCHAR(50) NOT NULL
        CHECK (flagged_by IN ('System', 'ProjectManager')),
    flag_type        VARCHAR(50) NOT NULL
        CHECK (flag_type IN ('BIR_Duplicate', 'Vendor_Validation', 'Ticket_Mismatch')),
    detection_layer  VARCHAR(30) NOT NULL
    CHECK (detection_layer IN ('Layer1', 'Layer2', 'Layer3')),
    reason           TEXT NOT NULL,
    resolution       VARCHAR(30) NOT NULL DEFAULT 'Pending'
        CHECK (resolution IN ('Pending', 'Approved', 'Rejected')),
    flagged_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    resolved_at      TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fraud_flags_expense ON fraud_flags(expense_id);

CREATE TABLE IF NOT EXISTS blockchain_logs (
    log_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_id           UUID NOT NULL REFERENCES expenses(expense_id),
    actor_id              UUID NOT NULL REFERENCES users(user_id),
    tx_hash               VARCHAR(100) UNIQUE,
    block_number           INTEGER,
    event_type             VARCHAR(50) NOT NULL
        CHECK (event_type IN ('ExpenseApproved', 'ReportGenerated', 'SyncCompleted')),
    validator_node_count    INTEGER,
    consensus_type          VARCHAR(30) NOT NULL DEFAULT 'Clique',
    status                  VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'failed')),
    timestamp                TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blockchain_logs_expense ON blockchain_logs(expense_id);
