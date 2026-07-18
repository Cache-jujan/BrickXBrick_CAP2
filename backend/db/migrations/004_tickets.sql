-- 004_tickets.sql
-- Matches Data Dictionary Table 33 (Tickets).
-- Supports F4 Project Ticket Management. F6-F8 need this table because
-- expenses.ticket_id references it (links an expense back to the Material
-- Request ticket that authorized the purchase, which F9 Layer 3 uses for
-- ticket-receipt mismatch detection).
--
-- Naming follows 002_users.sql: snake_case, unquoted identifiers.

CREATE TABLE IF NOT EXISTS tickets (
    ticket_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(project_id),
    submitted_by    UUID NOT NULL REFERENCES users(user_id),
    resolved_by     UUID REFERENCES users(user_id),
    assigned_to     UUID NOT NULL REFERENCES users(user_id),
    recipient_role  VARCHAR(50) NOT NULL
        CHECK (recipient_role IN ('Purchaser', 'SiteManager')),
    ticket_type     VARCHAR(50) NOT NULL
        CHECK (ticket_type IN ('MaterialRequest', 'WorkItem')),
    subject         VARCHAR(100) NOT NULL,
    description     TEXT,
    status          VARCHAR(30) NOT NULL DEFAULT 'Pending'
        CHECK (status IN ('Pending', 'Resolved', 'Rejected')),
    photo_url       TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- The two lookups F4/F6 do constantly: "tickets for this project" and
-- "tickets assigned to me" (manuscript test cases UTC021-UTC023).
CREATE INDEX IF NOT EXISTS idx_tickets_project_id ON tickets(project_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON tickets(assigned_to);