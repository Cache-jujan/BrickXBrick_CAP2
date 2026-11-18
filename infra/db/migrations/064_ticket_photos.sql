-- 064_ticket_photos.sql
-- Up to 3 photos per Report ticket, filed at creation time only.
-- Shape mirrors daily_checkin_photos (migration 048) and reuses the same
-- R2 upload path.
CREATE TABLE IF NOT EXISTS ticket_photos (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticketId   UUID NOT NULL REFERENCES tickets(ticketId) ON DELETE CASCADE,
    photoUrl   TEXT NOT NULL,
    sortOrder  INT  NOT NULL DEFAULT 0,
    createdAt  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticket_photos_ticket
    ON ticket_photos (ticketId, sortOrder);
