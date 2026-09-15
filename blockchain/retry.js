require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { submitHashWithTimeout } = require("./lib/blockchainWrite");

const dataDir = path.join(__dirname, "data");
const queueFile = path.join(dataDir, "pendingQueue.json");
const logFile = path.join(dataDir, "blockchainLogs.json");

function loadJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}

async function main() {
  const queue = loadJson(queueFile);
  if (queue.length === 0) {
    console.log("Queue is empty — nothing to retry.");
    return;
  }

  console.log(`Retrying ${queue.length} queued entr${queue.length === 1 ? "y" : "ies"}...`);

  const stillQueued = [];
  const logs = loadJson(logFile);

  for (const entry of queue) {
    console.log(`\nRetrying ${entry.expenseID}...`);
    try {
      const { txHash, blockNumber, fromAddress, validatorNodeCount } =
        await submitHashWithTimeout(process.env.GETH_RPC_URL, entry.hash, 15000);

      const record = {
        logID: crypto.randomUUID(),
        expenseID: entry.expenseID,
        actorID: fromAddress,
        txHash,
        blockNumber,
        eventType: "ExpenseApproved",
        validatorNodeCount,
        consensusType: "Clique",
        timestamp: new Date().toISOString()
      };
      logs.push(record);
      console.log("✅ Succeeded:", record);
    } catch (err) {
      if (err.message === "TIMEOUT") {
        console.log("⏳ Still insufficient validator nodes — staying queued.");
        stillQueued.push(entry);
      } else {
        console.log("Retry failed with an unexpected error:", err.message);
        stillQueued.push(entry);
      }
    }
  }

  fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
  fs.writeFileSync(queueFile, JSON.stringify(stillQueued, null, 2));

  console.log(`\nDone. ${queue.length - stillQueued.length} succeeded, ${stillQueued.length} still queued.`);
}

main().catch((err) => {
  console.error("retry.js failed:", err.message);
  process.exit(1);
});