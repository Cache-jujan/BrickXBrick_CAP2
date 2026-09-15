require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { hashExpense, submitHashWithTimeout } = require("./lib/blockchainWrite");

const fakeExpense = {
  expenseID: "exp-" + crypto.randomUUID(),
  projectID: "proj-demo-001",
  vendorName: "ABC Hardware Supply",
  amount: 15420.50,
  category: "Materials",
  receiptDate: "2026-07-15"
};

const dataDir = path.join(__dirname, "data");

function saveExpenseSnapshot(expense) {
  fs.mkdirSync(dataDir, { recursive: true });
  const expenseFile = path.join(dataDir, `${expense.expenseID}.json`);
  fs.writeFileSync(expenseFile, JSON.stringify(expense, null, 2));
  return expenseFile;
}

function appendToQueue(entry) {
  const queueFile = path.join(dataDir, "pendingQueue.json");
  const existing = fs.existsSync(queueFile)
    ? JSON.parse(fs.readFileSync(queueFile, "utf8"))
    : [];
  existing.push(entry);
  fs.writeFileSync(queueFile, JSON.stringify(existing, null, 2));
  return queueFile;
}

function appendToBlockchainLogs(record) {
  const logFile = path.join(dataDir, "blockchainLogs.json");
  const existing = fs.existsSync(logFile)
    ? JSON.parse(fs.readFileSync(logFile, "utf8"))
    : [];
  existing.push(record);
  fs.writeFileSync(logFile, JSON.stringify(existing, null, 2));
  return logFile;
}

async function main() {
  const hash = hashExpense(fakeExpense);
  console.log("Expense:", fakeExpense);
  console.log("SHA-256 hash:", hash);

  const expenseFile = saveExpenseSnapshot(fakeExpense);
  console.log("Saved expense snapshot to", expenseFile);

  try {
    const { txHash, blockNumber, fromAddress, validatorNodeCount } =
      await submitHashWithTimeout(process.env.GETH_RPC_URL, hash, 15000);

    console.log("Submitted tx:", txHash);
    console.log("Mined in block:", blockNumber);

    const record = {
      logID: crypto.randomUUID(),
      expenseID: fakeExpense.expenseID,
      actorID: fromAddress,
      txHash,
      blockNumber,
      eventType: "ExpenseApproved",
      validatorNodeCount,
      consensusType: "Clique",
      timestamp: new Date().toISOString()
    };

    const logFile = appendToBlockchainLogs(record);
    console.log("Saved BlockchainLogs record to", logFile);
    console.log(record);
    console.log("\nTo verify, run:");
    console.log(`node verify.js ${fakeExpense.expenseID}`);
  } catch (err) {
    if (err.message === "TIMEOUT") {
      // PART B — UC-12-01 Exception E1: fewer than 2 of 3 nodes online.
      // Instead of hanging forever (the actual bug this fixes) or
      // crashing, queue the expense for a later retry.
      const queueEntry = {
        expenseID: fakeExpense.expenseID,
        hash,
        queuedAt: new Date().toISOString()
      };
      const queueFile = appendToQueue(queueEntry);
      console.log("QUEUED — insufficient validator nodes, will retry later.");
      console.log("Saved to", queueFile);
      console.log(queueEntry);
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  console.error("store.js failed:", err.message);
  process.exit(1);
});