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
const { canonicalizeExpense, submitHashWithTimeout } = require("./lib/blockchainService");


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
app.use("/api/receipts", receiptRoutes);          // F6 OCR receipt scanning
app.use("/api/sync", syncRoutes);                 // F10 offline sync
app.use("/api/blockchain", blockchainRoutes);     // F12 audit trail

// --- Error handler (must stay last, after all routes) ---
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message, details: err.details });
});

const PORT = process.env.PORT || 3000;

// F12: automatically retry any expense stuck at blockchainStatus='Pending' every 60s.
async function retryPendingBlockchainWrites() {
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
}
setInterval(retryPendingBlockchainWrites, 60_000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend listening on port ${PORT}`);
});