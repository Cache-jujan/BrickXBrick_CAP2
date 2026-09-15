// blockchainWrite.js — shared hash-and-submit logic used by both
// store.js (first attempt) and retry.js (retry attempts), so the two
// files don't duplicate the same submission logic.
const crypto = require("crypto");
const { ethers } = require("ethers");

function hashExpense(expense) {
  const canonical = JSON.stringify(expense);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

// Submits the expense's hash on-chain and waits for it to be mined,
// but gives up after `timeoutMs` instead of hanging forever. Clique
// won't seal blocks with fewer than 2 of 3 signers online (proven in
// Spike 2), so an unbounded tx.wait() would hang indefinitely in that
// exact situation — this timeout is what turns that hang into a
// recoverable "queue and retry later" outcome instead.
async function submitHashWithTimeout(providerUrl, hash, timeoutMs = 15000) {
  const provider = new ethers.JsonRpcProvider(providerUrl);
  const signer = await provider.getSigner();
  const fromAddress = await signer.getAddress();

  const tx = await signer.sendTransaction({
    to: fromAddress,
    value: 0,
    data: "0x" + hash
  });

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)
  );

  const receipt = await Promise.race([tx.wait(), timeout]);

  const peers = await provider.send("admin_peers", []).catch(() => []);
  const validatorNodeCount = peers.length + 1;

  return { txHash: receipt.hash, blockNumber: receipt.blockNumber, fromAddress, validatorNodeCount };
}

module.exports = { hashExpense, submitHashWithTimeout };