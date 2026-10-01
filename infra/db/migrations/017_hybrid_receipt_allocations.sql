-- F8 hybrid receipt allocation.
-- Existing amount-only receiptallocations remain valid through the default
-- allocationmode='amount'; new quantity-mode rows reference a source receipt
-- line and record the quantity and cents assigned to one project.

CREATE TABLE ReceiptLineItems (
    lineItemID      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commonReceiptID VARCHAR(100) NOT NULL,
    lineNumber      INTEGER NOT NULL CHECK (lineNumber >= 1),
    description     TEXT NOT NULL,
    quantity        DECIMAL(10,2) NOT NULL CHECK (quantity > 0),
    unitPrice       DECIMAL(12,2) NULL CHECK (unitPrice IS NULL OR unitPrice >= 0),
    amount          DECIMAL(12,2) NOT NULL CHECK (amount >= 0),
    createdAt       TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (commonReceiptID, lineNumber),
    UNIQUE (commonReceiptID, lineItemID)
);

ALTER TABLE ReceiptAllocations
    ADD COLUMN lineItemID UUID NULL,
    ADD COLUMN allocationMode VARCHAR(20) NOT NULL DEFAULT 'amount'
        CHECK (allocationMode IN ('quantity', 'amount')),
    ADD COLUMN allocatedQuantity DECIMAL(10,2) NULL
        CHECK (allocatedQuantity IS NULL OR allocatedQuantity > 0),
    ADD COLUMN adjustmentAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN adjustmentType VARCHAR(20) NULL
        CHECK (adjustmentType IS NULL OR adjustmentType IN ('tax', 'discount', 'fee', 'rounding', 'other')),
    ADD CONSTRAINT receiptallocations_line_item_fk
        FOREIGN KEY (commonReceiptID, lineItemID)
        REFERENCES ReceiptLineItems (commonReceiptID, lineItemID),
    ADD CONSTRAINT receiptallocations_mode_fields_check
        CHECK (
            (allocationMode = 'quantity' AND lineItemID IS NOT NULL AND allocatedQuantity IS NOT NULL)
            OR
            (allocationMode = 'amount' AND lineItemID IS NULL AND allocatedQuantity IS NULL)
        );

-- A direct-amount fallback has no truthful physical quantity. Existing F6
-- submissions continue to store their derived quantity; F8 fallback expenses
-- may now store NULL rather than a fabricated quantity of one.
ALTER TABLE Expenses ALTER COLUMN quantity DROP NOT NULL;

CREATE INDEX receiptlineitems_commonreceipt_idx
    ON ReceiptLineItems (commonReceiptID);
CREATE INDEX receiptallocations_commonreceipt_idx
    ON ReceiptAllocations (commonReceiptID);
CREATE INDEX receiptallocations_lineitem_idx
    ON ReceiptAllocations (lineItemID);
