-- F10 Offline Operation & Data Synchronization.
-- Replaces the 006 sync spike (sync_test_records) with a real idempotency
-- ledger. Each offline action the mobile app queues carries a client-generated
-- UUID; we record the UUIDs we have already processed so a re-sent batch
-- (after a flaky reconnect) can never create the same record twice.

CREATE TABLE IF NOT EXISTS synced_actions (
    action_uuid  UUID PRIMARY KEY,                       -- client-generated idempotency key
    user_id      UUID NOT NULL REFERENCES Users(userID), -- who synced it
    action_type  VARCHAR(30) NOT NULL,                   -- 'expense' (task/ticket later)
    expense_id   UUID NULL REFERENCES Expenses(expenseID),
    synced_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
