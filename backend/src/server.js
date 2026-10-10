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
const { canonicalizeExpense, submitHashWithTimeout, getOnChainHash } = require("./lib/blockchainService");
const { tamperMessage } = require("./lib/tamperAlerts");
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
        const pending = await query("SELECT * FROM Expenses WHERE blockchainStatus = 'Pending' LIMIT 20");
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

// F12: proactively re-check every Confirmed expense's hash against the
// chain on a timer, instead of waiting for a GM to click "Verify" manually.
// On a mismatch: log it permanently, flip the expense to TamperDetected
// (which naturally excludes it from future scans), and notify every
// active System Administrator and the project's GM.
let scanRunning = false;
async function scanForTampering() {
    if (scanRunning) return;
    scanRunning = true;
    try {
        const confirmed = await query(
            "SELECT * FROM Expenses WHERE blockchainStatus = 'Confirmed' LIMIT 50"
        );

        for (const expense of confirmed.rows) {
            try {
                const logResult = await query(
                    "SELECT * FROM BlockchainLogs WHERE expenseID = $1 ORDER BY timestamp DESC LIMIT 1",
                    [expense.expenseid]
                );
                if (logResult.rowCount === 0) continue; // no chain record yet, skip

                const log = logResult.rows[0];
                const recomputedHash = canonicalizeExpense(expense);

                let onChainHash;
                try {
                    onChainHash = await getOnChainHash(log.txhash);
                } catch (netErr) {
                    console.log(`Tamper scan skipped ${expense.expenseid}: chain unreachable`);
                    continue; // node down is not tampering
                }
                const reason = onChainHash === null
                    ? `on-chain transaction ${log.txhash} could not be found`
                    : "recomputed hash does not match the stored on-chain value";

                if (onChainHash !== null && recomputedHash === onChainHash) continue; // still matches, nothing to do

                await query(
                    `INSERT INTO tamper_alerts (expenseID, recomputedHash, onChainHash)
                     VALUES ($1, $2, $3)`,
                    [expense.expenseid, recomputedHash, onChainHash || "MISSING"]
                );
                await query(
                    "UPDATE Expenses SET blockchainStatus = 'TamperDetected' WHERE expenseID = $1",
                    [expense.expenseid]
                );

                const message = tamperMessage(expense, onChainHash);

                const admins = await query(
                    "SELECT userid FROM users WHERE role = 'System Administrator' AND status = 'Active'"
                );
                for (const admin of admins.rows) {
                    await query(
                        `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
                         VALUES ($1, 'TamperAlert', 'Expense', $2, $3)`,
                        [admin.userid, expense.expenseid, message]
                    );
                }

                const projectResult = await query(
                    "SELECT createdby FROM projects WHERE projectid = $1",
                    [expense.projectid]
                );
                if (projectResult.rowCount > 0) {
                    await query(
                        `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
                         VALUES ($1, 'TamperAlert', 'Expense', $2, $3)`,
                        [projectResult.rows[0].createdby, expense.expenseid, message]
                    );
                }

                console.log(`TAMPER DETECTED on expense ${expense.expenseid} — ${reason}`);
            } catch (e) {
                console.error(`Tamper scan crashed on expense ${expense.expenseid}:`, e);
            }
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