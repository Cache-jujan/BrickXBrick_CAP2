// Hashes an expense and writes the hash to the chain.
// store.js and retry.js both call this, so the logic lives in one place.
const crypto = require("crypto");
const { Web3 } = require("web3");

// SHA-256 of the expense JSON. verify.js hashes the same way, so the two hashes only match if the expense is unchanged.
function hashExpense(expense) {
  return crypto.createHash("sha256").update(JSON.stringify(expense)).digest("hex");
}

// Sends the hash as a 0-value transaction to ourselves, with the hash in the data field.
// If it isn't confirmed within timeoutMs we throw "TIMEOUT" (usually fewer than 2 of 3 validators online).
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

  // Connected peers, plus this node, gives the validator count for the log.
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