-- 006_expenses.sql
-- Base columns match Data Dictionary Table 35 (Expenses) exactly.
--
-- NOTE ON EXTENSIONS (read before running):
-- The Data Dictionary's Expenses table only stores `bir_number` (the OR/SI
-- number). But F7 (BIR Field Verification) is specified to check THREE
-- fields: TIN, BIR Permit Number, and OR/SI Number. The dictionary doesn't
-- give TIN or Permit Number columns anywhere, so F7 can't be implemented
-- against the literal schema as written. I've added `tin` and
-- `bir_permit_number` below to close that gap - flagged clearly so you can
-- raise it with your adviser/panel if the schema needs to stay 1:1 with
-- the capstone document. Everything else below the "--- extensions ---"
-- line is similarly additive, not contradictory, to the dictionary.

CREATE TABLE IF NOT EXISTS expenses (
    expense_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id             UUID NOT NULL REFERENCES projects(project_id),
    submitted_by           UUID NOT NULL REFERENCES users(user_id),
    approved_by            UUID REFERENCES users(user_id),
    ticket_id              UUID REFERENCES tickets(ticket_id),
    vendor_name            VARCHAR(200) NOT NULL,
    amount                 DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    receipt_date           DATE NOT NULL,
    category               VARCHAR(50) NOT NULL
        CHECK (category IN ('Labor', 'Materials', 'Equipment', 'Other')),
    bir_validation_status  VARCHAR(20) NOT NULL DEFAULT 'Pending'
        CHECK (bir_validation_status IN ('Pending', 'Formal-Tax-Deductible', 'Informal')),
    receipt_image_url      TEXT NOT NULL,
    status                 VARCHAR(30) NOT NULL DEFAULT 'Pending'
        CHECK (status IN ('Pending', 'Approved', 'Rejected')),
    submitted_at            TIMESTAMP NOT NULL DEFAULT NOW(),
    bir_number             VARCHAR(20),   -- OR/SI Number (per dictionary)
    quantity                DECIMAL(10,2) NOT NULL DEFAULT 1,

    -- --- extensions (needed for F6/F7 to function; not in original dictionary) ---
    tin                     VARCHAR(20),              -- F7: Tax Identification Number
    bir_permit_number       VARCHAR(30),              -- F7: BIR Permit Number
    capture_method          VARCHAR(20)               -- F6: how the receipt was submitted
        CHECK (capture_method IN ('camera', 'gallery', 'pdf')),
    ocr_raw_response        JSONB,                     -- F6: full Vision API payload, for audit/debug
    ocr_line_items          JSONB,                     -- F6: [{description, amount}, ...]
    ocr_low_confidence_fields TEXT[],                  -- F6: field names flagged for manual review
    common_receipt_id       VARCHAR(100),              -- F8: shared id when this row is one split portion
    rejection_reason        TEXT,                      -- F9: populated on fraud/PM rejection
    created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_project ON expenses(project_id);
CREATE INDEX IF NOT EXISTS idx_expenses_submitted_by ON expenses(submitted_by);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_ticket ON expenses(ticket_id);
CREATE INDEX IF NOT EXISTS idx_expenses_common_receipt ON expenses(common_receipt_id);
-- Supports F9 Layer 1 duplicate check: full TIN + Permit + OR/SI combination
CREATE INDEX IF NOT EXISTS idx_expenses_bir_combo ON expenses(tin, bir_permit_number, bir_number);
