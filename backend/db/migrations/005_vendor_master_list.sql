-- 005_vendor_master_list.sql
-- Matches Data Dictionary Table 34 (VendorMasterList).
-- Used by F9 Layer 2 (Vendor List Validation) later, but F6/F7 read from
-- it too (e.g. to surface a known-vendor hint on the OCR confirmation
-- screen), so it belongs in the shared schema now.

CREATE TABLE IF NOT EXISTS vendor_master_list (
    vendor_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    added_by           UUID NOT NULL REFERENCES users(user_id),
    vendor_name        VARCHAR(200) NOT NULL UNIQUE,
    location           VARCHAR(200),
    historical_average DECIMAL(12,2),
    approval_status    VARCHAR(20) NOT NULL DEFAULT 'Approved'
        CHECK (approval_status IN ('Approved', 'Flagged')),
    created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_name ON vendor_master_list(vendor_name);
