-- 042_task_documents.sql
-- F3/F5 (planning phase): documents attached to a Planning-phase task, so a
-- GM- or PM-handled task can carry real evidence (title, permit, soil test,
-- approved plans...) instead of only being marked done.
--
-- Only metadata lives here. The file itself is in R2 under
-- task-documents/<taskId>/<uuid>.<ext>; storageKey is that key, never a URL,
-- so changing how files are served later (e.g. a private bucket with signed
-- links) needs no data migration.
--
-- Deleting is soft (deletedAt/deletedBy) so the record of what was attached
-- survives. sha256 is the hash of the stored bytes, kept so the file can be
-- proven unchanged later (e.g. anchored through F12).
--
-- Numbered 042: 041 is taken by the F4 ticket-audit migration on another
-- branch. Safe to re-run.

CREATE TABLE IF NOT EXISTS task_documents (
    documentId   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    taskId       UUID NOT NULL REFERENCES tasks(taskId),
    uploadedBy   UUID NOT NULL REFERENCES users(userId),
    fileName     VARCHAR(255) NOT NULL,
    contentType  VARCHAR(50)  NOT NULL
                 CHECK (contentType IN ('application/pdf', 'image/jpeg', 'image/png')),
    sizeBytes    INTEGER      NOT NULL CHECK (sizeBytes > 0),
    sha256       CHAR(64)     NOT NULL,
    storageKey   TEXT         NOT NULL UNIQUE,
    uploadedAt   TIMESTAMP    NOT NULL DEFAULT NOW(),
    deletedAt    TIMESTAMP    NULL,
    deletedBy    UUID         NULL REFERENCES users(userId)
);

CREATE INDEX IF NOT EXISTS idx_task_documents_task
    ON task_documents (taskId, uploadedAt)
    WHERE deletedAt IS NULL;
