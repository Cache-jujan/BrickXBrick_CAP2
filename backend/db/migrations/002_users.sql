-- 002_users.sql
-- Matches Data Dictionary Table 29 (Users).
-- F6-F8 need this table for FKs (submittedBy, approvedBy, addedBy, etc.)
-- even though F1 (RBAC) itself is a separate module. Real auth/session
-- logic is stubbed until F1 is built; this table just needs to exist so
-- foreign keys resolve.

CREATE TABLE IF NOT EXISTS users (
    user_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              VARCHAR(100) NOT NULL,
    email             VARCHAR(150) NOT NULL UNIQUE,
    supabase_user_id  UUID UNIQUE,
    role              VARCHAR(50) NOT NULL
        CHECK (role IN ('GeneralManager', 'ProjectManager', 'SiteManager', 'Purchaser', 'SystemAdministrator')),
    status            VARCHAR(20) NOT NULL DEFAULT 'Active'
        CHECK (status IN ('Active', 'Inactive')),
    lockout_until     TIMESTAMP,
    created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
