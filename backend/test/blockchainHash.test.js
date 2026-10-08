// The expense hash must not depend on the server's timezone. Laptops run on
// Asia/Manila and Cloud Run on UTC; a timezone-dependent hash raised false
// tamper alerts on every expense recorded from a laptop.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const servicePath = path.join(__dirname, "../src/lib/blockchainService.js");

// Hash recorded by the original code on a Philippine-time laptop for this
// expense (receiptDate 2026-07-15). Existing on-chain records look like this.
const MANILA_HASH_INPUT = JSON.stringify({
    expenseID: "e1",
    projectID: "p1",
    submittedBy: "u1",
    vendorName: "Krislee Enterprises",
    amount: "2800.00",
    receiptDate: "2026-07-14T16:00:00.000Z",
    category: "Materials",
    birValidationStatus: "Informal",
    quantity: "1.00",
});
const EXPECTED = require("node:crypto").createHash("sha256").update(MANILA_HASH_INPUT).digest("hex");

function hashIn(timezone, receiptDateExpr) {
    const script = `
        const { canonicalizeExpense } = require(${JSON.stringify(servicePath)});
        process.stdout.write(canonicalizeExpense({
            expenseid: "e1", projectid: "p1", submittedby: "u1",
            vendorname: "Krislee Enterprises", amount: "2800.00",
            receiptdate: ${receiptDateExpr},
            category: "Materials", birvalidationstatus: "Informal", quantity: "1.00",
        }));`;
    return execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ: timezone } }).toString();
}

for (const tz of ["Asia/Manila", "UTC", "America/Los_Angeles"]) {
    test(`hash matches existing Manila records when the server runs in ${tz}`, () => {
        // node-postgres hands DATE columns over as a Date at local midnight
        assert.strictEqual(hashIn(tz, "new Date(2026, 6, 15)"), EXPECTED);
    });
}

test("hash is the same when receiptDate arrives as a plain YYYY-MM-DD string", () => {
    assert.strictEqual(hashIn("UTC", '"2026-07-15"'), EXPECTED);
});
