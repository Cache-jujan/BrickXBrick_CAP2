-- infra/db/migrations/005_ticket_workflow_correction.sql

-- F4 workflow correction: ticketType is no longer a routing switch. SM creates
-- on their own assigned project, PM acknowledges (assigning a Purchaser), the
-- Purchaser resolves or rejects. recipientRole was only ever used to route
-- Material Request -> Purchaser / Work Item -> Site Manager at creation time;
-- that logic is gone.
ALTER TABLE Tickets DROP COLUMN recipientRole;

-- assignedTo is now populated at acknowledge-time (by the PM, to a specific
-- Purchaser), not at creation-time. Must be nullable for the Pending state.
ALTER TABLE Tickets ALTER COLUMN assignedTo DROP NOT NULL;