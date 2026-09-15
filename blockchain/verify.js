require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function hashExpense(expense) {
  const canonical = JSON.stringify(expense);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

async function main() {
  const expenseID = process.argv[2];
  if (!expenseID) {
    console.error("Usage: node verify.js <expenseID>");
    process.exit(1);
  }

  const dataDir = path.join(__dirname, "data");
  const expenseFile = path.join(dataDir, `${expenseID}.json`);
  const logFile = path.join(dataDir, "blockchainLogs.json");

  if (!fs.existsSync(expenseFile) || !fs.existsSync(logFile)) {
    console.error("No stored expense/log found for that expenseID. Run store.js first.");
    process.exit(1);
  }

  const expense = JSON.parse(fs.readFileSync(expenseFile, "utf8"));
  const logs = JSON.parse(fs.readFileSync(logFile, "utf8"));
  const record = logs.find((l) => l.expenseID === expenseID);
  if (!record) {
    console.error("No BlockchainLogs record for that expenseID.");
    process.exit(1);
  }

  const recomputedHash = hashExpense(expense);

  const provider = new ethers.JsonRpcProvider(process.env.GETH_RPC_URL);
  const onChainTx = await provider.getTransaction(record.txHash);
  if (!onChainTx) {
    console.error("Could not find tx on-chain. Is the geth container still running with the same data volume?");
    process.exit(1);
  }
  const onChainHash = onChainTx.data.replace(/^0x/, "");

  console.log("Expense (current):", expense);
  console.log("Recomputed SHA-256:", recomputedHash);
  console.log("On-chain hash:     ", onChainHash);

  if (recomputedHash === onChainHash) {
    console.log(`${GREEN}==================================${RESET}`);
    console.log(`${GREEN}   RESULT: VERIFIED ${RESET}`);
    console.log(`${GREEN}==================================${RESET}`);
    return;
  }

  console.log(`${RED}==================================${RESET}`);
  console.log(`${RED}   RESULT: TAMPERED ${RESET}`);
  console.log(`${RED}==================================${RESET}`);

  // PART A — Appendix H sub-point 7: log tamper alert permanently.
  // Stand-in for the `tamper_alerts` table (flagged earlier as a Data
  // Dictionary gap) — this is deliberately a minimal shape, not a guess
  // at the real schema, which still needs to formalize.
  const alert = {
    alertID: crypto.randomUUID(),
    expenseID,
    recomputedHash,
    onChainHash,
    detectedAt: new Date().toISOString()
  };

  const alertsFile = path.join(dataDir, "tamperAlerts.json");
  const existingAlerts = fs.existsSync(alertsFile)
    ? JSON.parse(fs.readFileSync(alertsFile, "utf8"))
    : [];
  existingAlerts.push(alert);
  fs.writeFileSync(alertsFile, JSON.stringify(existingAlerts, null, 2));

  // PART A — Appendix H sub-point 8: notify SysAdmin on tamper detection.
  // Spike shortcut: console output only. Real F12 would push this to an
  // actual channel (email/SMS/push) via a notification service — not
  // implemented here, this just proves the trigger point exists.
  console.log(`${YELLOW}==================================${RESET}`);
  console.log(`${YELLOW}   SYSADMIN NOTIFIED${RESET}`);
  console.log(`${YELLOW}   expenseID: ${expenseID}${RESET}`);
  console.log(`${YELLOW}   at: ${alert.detectedAt}${RESET}`);
  console.log(`${YELLOW}==================================${RESET}`);
  console.log("Tamper alert saved to", alertsFile);
}

main().catch((err) => {
  console.error("verify.js failed:", err.message);
  process.exit(1);
});