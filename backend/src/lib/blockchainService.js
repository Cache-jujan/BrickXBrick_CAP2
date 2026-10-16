// blockchainService.js — production wiring of the F12 spike logic into the
// live backend. Wraps hashExpense/submitHashWithTimeout so routes never
// touch ethers.js directly.
const crypto = require("crypto");
const { Web3 } = require("web3");

const RPC_URL = process.env.GETH_RPC_URL;
const SUBMIT_TIMEOUT_MS = 30000;

// receiptDate is a Postgres DATE. node-postgres turns it into a JS Date at
// midnight in the *server's* timezone, so hashing the raw value gave
// different results on a laptop (Asia/Manila) and on Cloud Run (UTC) and
// raised false tamper alerts. Every hash recorded so far was made on
// Philippine time, so we normalise to "midnight in Manila" no matter where
// the server runs — existing on-chain hashes stay valid.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

function canonicalReceiptDate(value) {
    if (value === null || value === undefined) return value;
    let year, month, day;
    if (value instanceof Date) {
        year = value.getFullYear();
        month = value.getMonth();
        day = value.getDate();
    } else {
        const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
        year = y;
        month = m - 1;
        day = d;
    }
    return new Date(Date.UTC(year, month, day) - MANILA_OFFSET_MS).toISOString();
}

function canonicalizeExpense(expense) {
    // Only hash the fields that define the record's financial truth —
    // not volatile bookkeeping columns like updatedAt.
    const canonical = {
        expenseID: expense.expenseid,
        projectID: expense.projectid,
        submittedBy: expense.submittedby,
        vendorName: expense.vendorname,
        amount: expense.amount,
        receiptDate: canonicalReceiptDate(expense.receiptdate),
        category: expense.category,
        birValidationStatus: expense.birvalidationstatus,
        quantity: expense.quantity,
    };
    return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// --- F11: report hash ----------------------------------------------------
// A report is hashed from the report_events row, so the hash can be
// recomputed later from what is stored. Same lessons as the expense hash:
// fixed key order, sorted ids, and no value that depends on server timezone.

// pg returns a DATE as a Date at the server's local midnight, so read the
// local calendar fields (the same day on any server). Strings pass through.
function canonicalDay(value) {
    if (value instanceof Date) {
        const pad = (n) => String(n).padStart(2, "0");
        return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    }
    return String(value).slice(0, 10);
}

// 37000.5 -> "37000.50". Whole centavos, so -0 and float noise cannot leak in.
function money2(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error("report total is not a number");
    const cents = Math.round(number * 100) + 0;
    const sign = cents < 0 ? "-" : "";
    const abs = Math.abs(cents);
    return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// row: a report_events row (lower-case pg column names). row.totals holds the
// summary figures that were shown and exported (see lib/reportSummary.js).
function canonicalizeReport(row) {
    const projects = (row.totals && row.totals.projects) || [];
    if (projects.length === 0) throw new Error("report has no per-project totals to hash");

    const canonical = {
        reportId: row.reportid,
        generatedBy: row.generatedby,
        projectIds: [...row.projectids].map((id) => String(id).toLowerCase()).sort(),
        from: canonicalDay(row.periodfrom),
        to: canonicalDay(row.periodto),
        generatedAt: new Date(row.generatedat).toISOString(),
        projects: projects
            .map((project) => ({
                projectId: String(project.projectId).toLowerCase(),
                budget: money2(project.budget),
                periodSpend: money2(project.periodSpend),
                cumulativeSpend: money2(project.cumulativeSpend),
                birDeductibleSpend: money2(project.birDeductibleSpend),
            }))
            .sort((a, b) => (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0)),
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
    if (!tx) return null;
    return tx.input.replace(/^0x/, "");
}


module.exports = { canonicalizeExpense, canonicalizeReport, submitHashWithTimeout, getOnChainHash };