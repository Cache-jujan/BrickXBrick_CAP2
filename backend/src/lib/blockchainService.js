// blockchainService.js — production wiring of the F12 spike logic into the
// live backend. Wraps hashExpense/submitHashWithTimeout so routes never
// touch ethers.js directly.
const crypto = require("crypto");
const { ethers } = require("ethers");

const RPC_URL = process.env.GETH_RPC_URL; // e.g. http://localhost:8551 (node1 exposed port)
const SUBMIT_TIMEOUT_MS = 15000;

function canonicalizeExpense(expense) {
    // Only hash the fields that define the record's financial truth —
    // not volatile bookkeeping columns like updatedAt.
    const canonical = {
        expenseID: expense.expenseid,
        projectID: expense.projectid,
        submittedBy: expense.submittedby,
        vendorName: expense.vendorname,
        amount: expense.amount,
        receiptDate: expense.receiptdate,
        category: expense.category,
        birValidationStatus: expense.birvalidationstatus,
        quantity: expense.quantity,
    };
    return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function submitHashWithTimeout(hash) {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer = await provider.getSigner();
    const fromAddress = await signer.getAddress();

    const tx = await signer.sendTransaction({ to: fromAddress, value: 0, data: "0x" + hash });

    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), SUBMIT_TIMEOUT_MS)
    );
    const receipt = await Promise.race([tx.wait(), timeout]);

    const peers = await provider.send("admin_peers", []).catch(() => []);
    const validatorNodeCount = peers.length + 1;

    return { txHash: receipt.hash, blockNumber: receipt.blockNumber, fromAddress, validatorNodeCount };
}

async function getOnChainHash(txHash) {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const tx = await provider.getTransaction(txHash);
    if (!tx) throw new Error("Transaction not found on-chain");
    return tx.data.replace(/^0x/, "");
}

module.exports = { canonicalizeExpense, submitHashWithTimeout, getOnChainHash };