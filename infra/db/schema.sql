-- Brick x Brick — PostgreSQL schema
-- Source: Manuscript Chapter III, Database Design & Data Dictionary (Tables 29-38)
-- Order respects FK dependencies.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- Table 29: Users
CREATE TABLE Users (
    userID         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name           VARCHAR(100) NOT NULL,
    email          VARCHAR(150) NOT NULL UNIQUE,
    supabaseUserId UUID NOT NULL UNIQUE, -- links to Supabase Auth; passwords never stored here
    role           VARCHAR(50) NOT NULL, -- General Manager | Project Manager | Site Manager | Purchaser | System Administrator
    status         VARCHAR(20) NOT NULL DEFAULT 'Active', -- Active | Inactive
    lockoutUntil   TIMESTAMP NULL, -- set after 5 consecutive failed logins
    createdAt      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table 30: Projects
CREATE TABLE Projects (
    projectID   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    createdBy   UUID NOT NULL REFERENCES Users(userID), -- must be General Manager
    name        VARCHAR(150) NOT NULL,
    description TEXT NULL,
    clientName  VARCHAR(150) NOT NULL,
    status      VARCHAR(30) NOT NULL DEFAULT 'Draft', -- Draft | Active | Completed | Archived
    startDate   DATE NOT NULL,
    endDate     DATE NULL,
    budget      DECIMAL(15,2) NOT NULL
);

-- Table 31: Milestones
CREATE TABLE Milestones (
    milestoneID          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    projectID            UUID NOT NULL REFERENCES Projects(projectID),
    createdBy            UUID NOT NULL REFERENCES Users(userID), -- must be Project Manager
    name                 VARCHAR(150) NOT NULL,
    dueDate              DATE NOT NULL,
    completionPercentage DECIMAL(5,2) NOT NULL DEFAULT 0, -- avg of child task %
    status               VARCHAR(30) NOT NULL DEFAULT 'On Track', -- On Track | At Risk | Overdue | Completed
    completedAt          TIMESTAMP NULL
);

-- Table 32: Tasks
CREATE TABLE Tasks (
    taskID                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    milestoneID                UUID NOT NULL REFERENCES Milestones(milestoneID),
    assignedTo                 UUID NOT NULL REFERENCES Users(userID), -- must be Site Manager
    updatedBy                  UUID NULL REFERENCES Users(userID),
    taskName                   VARCHAR(150) NOT NULL,
    completionPercentage       DECIMAL(5,2) NOT NULL DEFAULT 0,
    photoEvidenceURL           TEXT NULL, -- max 10MB, JPEG/PNG
    status                     VARCHAR(30) NOT NULL DEFAULT 'Pending', -- Pending | In Progress | Completed
    dueDate                    DATE NOT NULL,
    issueReport                TEXT NULL,
    scheduleVarianceAlertSent  BOOLEAN NOT NULL DEFAULT FALSE,
    lastUpdatedAt              TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table 33: Tickets
CREATE TABLE Tickets (
    ticketID       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    projectID      UUID NOT NULL REFERENCES Projects(projectID),
    submittedBy    UUID NOT NULL REFERENCES Users(userID), -- Project Manager
    resolvedBy     UUID NULL REFERENCES Users(userID),
    assignedTo     UUID NOT NULL REFERENCES Users(userID),
    recipientRole  VARCHAR(50) NOT NULL, -- Purchaser | Site Manager
    ticketType     VARCHAR(50) NOT NULL, -- Material Request | Work Item
    subject        VARCHAR(100) NOT NULL,
    description    TEXT NULL,
    status         VARCHAR(30) NOT NULL DEFAULT 'Pending', -- Pending | Resolved | Rejected
    photoURL       TEXT NULL,
    createdAt      TIMESTAMP NOT NULL DEFAULT NOW(),
    resolvedAt     TIMESTAMP NULL,
    updatedAt      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table 34: VendorMasterList
CREATE TABLE VendorMasterList (
    vendorID          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    addedBy           UUID NOT NULL REFERENCES Users(userID), -- System Administrator only
    vendorName        VARCHAR(200) NOT NULL UNIQUE,
    location          VARCHAR(200) NULL,
    historicalAverage DECIMAL(12,2) NULL, -- 3-month rolling avg, used by F9 Layer 2
    approvalStatus    VARCHAR(20) NOT NULL DEFAULT 'Approved', -- Approved | Flagged
    createdAt         TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table 35: Expenses
CREATE TABLE Expenses (
    expenseID           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    projectID           UUID NOT NULL REFERENCES Projects(projectID),
    submittedBy         UUID NOT NULL REFERENCES Users(userID), -- Purchaser primary
    approvedBy          UUID NULL REFERENCES Users(userID), -- Project Manager
    ticketID            UUID NULL REFERENCES Tickets(ticketID), -- originating Material Request
    vendorName          VARCHAR(200) NOT NULL, -- OCR-extracted
    amount              DECIMAL(12,2) NOT NULL,
    receiptDate         DATE NOT NULL,
    category            VARCHAR(50) NOT NULL, -- Labor | Materials | Equipment | Other
    birValidationStatus VARCHAR(20) NOT NULL, -- Formal-Tax-Deductible | Informal (from F7)
    receiptImageURL     TEXT NOT NULL, -- AES-256 encrypted, stored in Cloudflare R2
    status              VARCHAR(30) NOT NULL DEFAULT 'Pending', -- Pending | Approved | Rejected
    submittedAt         TIMESTAMP NOT NULL DEFAULT NOW(),
    birNumber           VARCHAR(20) NULL,
    quantity            DECIMAL(10,2) NOT NULL
);

-- Table 36: ReceiptAllocations (F8 split receipts)
CREATE TABLE ReceiptAllocations (
    allocationID    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expenseID       UUID NOT NULL REFERENCES Expenses(expenseID),
    projectID       UUID NOT NULL REFERENCES Projects(projectID),
    allocatedAmount DECIMAL(12,2) NOT NULL,
    commonReceiptID VARCHAR(100) NOT NULL, -- sum of allocatedAmount per commonReceiptID must equal parent expense.amount (enforce in app layer)
    createdAt       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Table 37: FraudFlags (F9 multi-layer screening)
CREATE TABLE FraudFlags (
    flagID         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expenseID      UUID NOT NULL REFERENCES Expenses(expenseID),
    reviewedBy     UUID NULL REFERENCES Users(userID), -- Project Manager
    flaggedBy      VARCHAR(50) NOT NULL, -- system | manual
    flagType       VARCHAR(50) NOT NULL, -- BIR_Duplicate | Vendor_Validation | Ticket_Mismatch
    detectionLayer VARCHAR(30) NOT NULL, -- Layer 1 | Layer 2 | Layer 3
    reason         TEXT NOT NULL,
    resolution     VARCHAR(30) NOT NULL DEFAULT 'Pending', -- Pending | Approved | Rejected
    flaggedAt      TIMESTAMP NOT NULL DEFAULT NOW(),
    resolvedAt     TIMESTAMP NULL
);

-- Table 38: BlockchainLogs (F12)
CREATE TABLE BlockchainLogs (
    logID              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expenseID          UUID NOT NULL REFERENCES Expenses(expenseID),
    actorID            UUID NOT NULL REFERENCES Users(userID),
    txHash             VARCHAR(100) NOT NULL UNIQUE, -- SHA-256 from Geth Clique PoA
    blockNumber        INTEGER NOT NULL,
    eventType          VARCHAR(50) NOT NULL, -- ExpenseApproved | ReportGenerated | SyncCompleted
    validatorNodeCount INTEGER NOT NULL, -- min 2 of 3 required
    consensusType      VARCHAR(30) NOT NULL DEFAULT 'Clique',
    timestamp          TIMESTAMP NOT NULL
);

-- NOTE: three additional SQLite tables (offlineExpenseQueue, offlineTaskUpdates,
-- offlineTicketInteractions) exist ONLY on the Android device for F10 offline
-- support. They are not part of this Postgres schema — build those when you
-- reach F10, not now.