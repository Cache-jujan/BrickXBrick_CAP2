// blockchainWrite.js — shared hash-and-submit logic used by both
// store.js (first attempt) and retry.js (retry attempts), so the two
// files don't duplicate the same submission logic.
const crypto = require("crypto");
const { Web3 } = require("web3");

function hashExpense(expense) {
  return crypto.createHash("sha256").update(JSON.stringify(expense)).digest("hex");
}

async function submitHashWithTimeout(providerUrl, hash, timeoutMs = 30000) {
  const web3 = new Web3(providerUrl);
  const [fromAddress] = await web3.eth.getAccounts();

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)
  );
  const send = web3.eth.sendTransaction({
    from: fromAddress,
    to: fromAddress,
    value: 0,
    data: "0x" + hash,
  });
  const receipt = await Promise.race([send, timeout]);

  const peers = await web3.requestManager
    .send({ method: "admin_peers", params: [] })
    .catch(() => []);

  return {
    txHash: receipt.transactionHash,
    blockNumber: Number(receipt.blockNumber),
    fromAddress,
    validatorNodeCount: peers.length + 1,
  };
}

module.exports = { hashExpense, submitHashWithTimeout };