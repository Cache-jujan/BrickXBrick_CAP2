require("dotenv").config();
const express = require("express");
const cors = require("cors");

const { requireAuth } = require("./middleware/auth");
const { query } = require("./lib/db");

const adminUsers = require("./routes/adminUsers");
const authRoutes = require("./routes/auth");
const expenseRoutes = require("./routes/expenses");
const milestoneRoutes = require("./routes/milestones");
const projectRoutes = require("./routes/projects");
const receiptRoutes = require("./routes/receipts");
const syncRoutes = require("./routes/sync");
const taskRoutes = require("./routes/tasks");
const ticketRoutes = require("./routes/tickets");
const blockchainRoutes = require("./routes/blockchain");
const { canonicalizeExpense, submitHashWithTimeout, getOnChainHash } = require("./lib/blockchainService");
const notificationRoutes = require("./routes/notifications");

const app = express();
app.use(cors());
app.use(express.json());

// --- Health / session ---
app.get("/health", (req, res) => res.json({ ok: true }));
app.get("/api/me", requireAuth, (req, res) => res.json({ user: req.user }));

// --- Routes ---
app.use("/api/auth", authRoutes);                 // login / session
app.use("/api/admin/users", adminUsers);          // F1 account management
app.use("/api/projects", projectRoutes);          // F2 projects
app.use("/api/milestones", milestoneRoutes);      // F3 milestones
app.use("/api/tasks", taskRoutes);                // F3 tasks
app.use("/api/tickets", ticketRoutes);            // F4 tickets
app.use("/api/expenses", expenseRoutes);          // F6 expenses
app.use("/receipts/files", express.static(require("./lib/receiptStorage").STORAGE_DIR));
app.use("/api/receipts", receiptRoutes);          // F6 OCR receipt scanning
app.use("/api/sync", syncRoutes);                 // F10 offline sync
app.use("/api/blockchain", blockchainRoutes);     // F12 audit trail

app.use("/api/notifications", notificationRoutes); // notifications

// --- Error handler (must stay last, after all routes) ---
app.use((err, req, res, next) => {
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
                let reason;
                try {
                    onChainHash = await getOnChainHash(log.txhash);
                } catch (lookupErr) {
                    onChainHash = null;
                    reason = `on-chain transaction ${log.txhash} could not be found (${lookupErr.message})`;
                }

                if (onChainHash !== null && recomputedHash === onChainHash) continue; // still matches, nothing to do

                reason = reason || "recomputed hash does not match the stored on-chain value";

                await query(
                    `INSERT INTO tamper_alerts (expenseID, recomputedHash, onChainHash)
                     VALUES ($1, $2, $3)`,
                    [expense.expenseid, recomputedHash, onChainHash || "MISSING"]
                );
                await query(
                    "UPDATE Expenses SET blockchainStatus = 'TamperDetected' WHERE expenseID = $1",
                    [expense.expenseid]
                );

                const message = `Tamper detected: expense "${expense.vendorname}" (₱${expense.amount}) — ${reason}.`;

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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on port ${PORT}`);
});