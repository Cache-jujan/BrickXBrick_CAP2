// blockchainService.js — production wiring of the F12 spike logic into the
// live backend. Wraps hashExpense/submitHashWithTimeout so routes never
// touch ethers.js directly.
const crypto = require("crypto");
const { Web3 } = require("web3");

const RPC_URL = process.env.GETH_RPC_URL;
const SUBMIT_TIMEOUT_MS = 30000;

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
    const web3 = new Web3(RPC_URL);
    const [fromAddress] = await web3.eth.getAccounts();

    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), SUBMIT_TIMEOUT_MS)
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
    const validatorNodeCount = peers.length + 1;

    return {
        txHash: receipt.transactionHash,
        blockNumber: Number(receipt.blockNumber),
        fromAddress,
        validatorNodeCount,
    };
}

async function getOnChainHash(txHash) {
    const web3 = new Web3(RPC_URL);
    const tx = await web3.eth.getTransaction(txHash);
    if (!tx) throw new Error("Transaction not found on-chain");
    return tx.input.replace(/^0x/, ""); 
}


module.exports = { canonicalizeExpense, submitHashWithTimeout, getOnChainHash };