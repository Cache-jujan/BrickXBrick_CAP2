-- infra/db/migrations/006_ticket_status_transitions.sql
-- F4: append-only audit trail for every ticket status transition, per
-- manuscript UC-04-01 / F4 Functional Decomposition ("immutable audit
-- history for all status transitions"). Replaces relying on acknowledgedAt/
-- resolvedAt alone, which only remembers the latest stage, not the path.

CREATE TABLE ticket_status_transitions (
    transitionId UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticketId     UUID NOT NULL REFERENCES tickets(ticketId),
    fromStatus   VARCHAR(30) NULL, -- NULL for the initial creation row (no prior state)
    toStatus     VARCHAR(30) NOT NULL CHECK (toStatus IN ('Pending', 'Acknowledged', 'Resolved', 'Rejected')),
    changedBy    UUID NOT NULL REFERENCES users(userId),
    changedAt    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Also close a gap: we currently store WHO got assigned at acknowledge-time
-- (assignedTo) but not WHO the acknowledging PM was. That's separate info.
ALTER TABLE tickets ADD COLUMN acknowledgedBy UUID NULL REFERENCES users(userId);