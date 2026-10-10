require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { requireAuth } = require("./middleware/auth");
const { query, withTransaction } = require("./lib/db");
const { sweepScheduleVariance } = require("./lib/milestoneProgress");

const adminUsers = require("./routes/adminUsers");
const authRoutes = require("./routes/auth");
const expenseRoutes = require("./routes/expenses");
const milestoneRoutes = require("./routes/milestones");
const projectRoutes = require("./routes/projects");
const bomRoutes = require("./routes/bom");
const receiptRoutes = require("./routes/receipts");
const syncRoutes = require("./routes/sync");
const taskRoutes = require("./routes/tasks");
const ticketRoutes = require("./routes/tickets");
const blockchainRoutes = require("./routes/blockchain");
const { canonicalizeExpense, submitHashWithTimeout } = require("./lib/blockchainService");
const { runIntegrityScan } = require("./lib/integrityCheck");
const notificationRoutes = require("./routes/notifications");
const allocationRoutes = require("./routes/allocations");

const app = express();
app.use(cors());
app.use(express.json());

// --- Health / session ---
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/api/me", requireAuth, (req, res) => res.json({ user: req.user }));

// --- Routes ---
app.use("/api/auth", authRoutes);                 // login / session
app.use("/api/admin/users", adminUsers);          // F1 account management
app.use("/api/projects/:projectId/bom", bomRoutes); // F2 bill of materials
app.use("/api/projects", projectRoutes);          // F2 projects
app.use("/api/milestones", milestoneRoutes);      // F3 milestones
app.use("/api/tasks", taskRoutes);                // F3 tasks
app.use("/api/tickets", ticketRoutes);            // F4 tickets
app.use("/api/expenses", expenseRoutes);          // F6 expenses
app.use("/api/allocations", allocationRoutes);     // F8 split receipt allocation
app.use("/receipts/files", express.static(require("./lib/receiptStorage").STORAGE_DIR));
app.use("/api/receipts", receiptRoutes);          // F6 OCR receipt scanning
app.use("/api/sync", syncRoutes);                 // F10 offline sync
app.use("/api/blockchain", blockchainRoutes);     // F12 audit trail

app.use("/api/notifications", notificationRoutes); // notifications

// D-09: malformed input (bad UUID, bad date) was never validated before
// hitting Postgres, so it bubbled up here as a raw driver error — 500s with
// text like `invalid input syntax for type uuid: "abc"`, leaking schema
// details and failing checks that expected a clean 400. Map the common
// input-shaped SQLSTATE codes to 400 and stop echoing unmapped DB errors.
const PG_INPUT_ERROR_CODES = new Set([
  "22P02", // invalid_text_representation (bad UUID, bad int, ...)
  "22007", // invalid_datetime_format
  "22008", // datetime_field_overflow
  "22001", // string_data_right_truncation
]);

// --- Error handler (must stay last, after all routes) ---
app.use((err, req, res, next) => {
  if (!err.status && err.code) {
    if (PG_INPUT_ERROR_CODES.has(err.code)) {
      return res.status(400).json({ error: "Invalid input value" });
    }
    // Any other raw Postgres error reaching here is a bug, not a bad
    // request — don't leak schema/column details in the response body.
    console.error("Unhandled DB error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
  res.status(err.status || 500).json({ error: err.message, details: err.details });
});

const PORT = process.env.PORT || 3000;

// F12: automatically retry any expense stuck at blockchainStatus='Pending' every 60s.
let retryRunning = false;
async function retryPendingBlockchainWrites() {
    if (retryRunning) return;
    retryRunning = true;
    try {
        // Only approved expenses that have NEVER been secured. An expense that
        // already has a chain record is never re-secured: otherwise setting its
        // status to 'Pending' would write a fresh hash of changed data.
        const pending = await query(
            `SELECT * FROM Expenses e
              WHERE e.blockchainStatus = 'Pending' AND e.status = 'Approved'
                AND NOT EXISTS (SELECT 1 FROM BlockchainLogs bl
                                 WHERE bl.expenseID = e.expenseID AND bl.eventType = 'ExpenseApproved')
              LIMIT 20`
        );
        for (const expense of pending.rows) {
            try {
                const hash = canonicalizeExpense(expense);
                const { txHash, blockNumber, validatorNodeCount } = await submitHashWithTimeout(hash);
                await query(
                    `INSERT INTO BlockchainLogs (expenseID, actorID, txHash, blockNumber, eventType, validatorNodeCount, consensusType)
                     VALUES ($1, $2, $3, $4, 'ExpenseApproved', $5, 'Clique')`,
                    [expense.expenseid, expense.approvedby || expense.submittedby, txHash, blockNumber, validatorNodeCount]
                );
                await query("UPDATE Expenses SET blockchainStatus = 'Confirmed' WHERE expenseID = $1", [expense.expenseid]);
                console.log(`Retry succeeded for expense ${expense.expenseid}`);
            } catch (e) {
                console.log(`Retry still failing for ${expense.expenseid}: ${e.message}`);
            }
        }
    } catch (e) {
        console.error("Retry pass failed:", e.message);
    } finally {
        retryRunning = false;
    }
}
setInterval(retryPendingBlockchainWrites, 60_000);

// F12: proactively re-check secured expenses against the hash written to
// the chain at approval, instead of waiting for a GM to click "Verify".
// Covers EVERY expense with a chain record, whatever its blockchainStatus
// says, least recently checked first (lib/integrityCheck.js). Mismatches
// raise an alert (re-created if someone deleted it) and notify every active
// System Administrator and General Manager.
let scanRunning = false;
async function scanForTampering() {
    if (scanRunning) return;
    scanRunning = true;
    try {
        const counts = await runIntegrityScan();
        if (counts.mismatch || counts.unreachable) {
            console.log(`Integrity scan: ${JSON.stringify(counts)}`);
        }
    } catch (e) {
        console.error("Tamper scan pass failed:", e.message);
    } finally {
        scanRunning = false;
    }
}
setInterval(scanForTampering, 180_000); // every 3 minutes

// F3/F5: schedule variance is otherwise only recomputed on task-create or
// PM Acknowledge, so a milestone/task that goes stale with no activity
// never flips to At Risk/Overdue (D-01) and an overdue task under an
// on-track milestone never alerts (D-08). Sweep on a timer, same pattern
// as the tamper scan above.
let varianceSweepRunning = false;
async function runScheduleVarianceSweep() {
    if (varianceSweepRunning) return;
    varianceSweepRunning = true;
    try {
        await withTransaction((client) => sweepScheduleVariance(client));
    } catch (e) {
        console.error("Schedule variance sweep failed:", e.message);
    } finally {
        varianceSweepRunning = false;
    }
}
setInterval(runScheduleVarianceSweep, 120_000); // every 2 minutes

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on port ${PORT}`);
});