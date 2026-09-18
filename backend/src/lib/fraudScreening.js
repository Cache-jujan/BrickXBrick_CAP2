// fraudScreening.js — F9 Layer 1: BIR duplicate check.
// Flags an expense whose TIN + BIR permit number + BIR/OR-SI number

const { query } = require("./db");

async function checkDuplicate(expense) {
    const { tin, birpermitnumber, birnumber, expenseid } = expense;

    if (!tin || !birpermitnumber || !birnumber) return false;

    const result = await query(
        `SELECT expenseID FROM Expenses
         WHERE tin = $1 AND birPermitNumber = $2 AND birNumber = $3
         AND expenseID != $4`,
        [tin, birpermitnumber, birnumber, expenseid]
    );

    return result.rowCount > 0;
}

module.exports = { checkDuplicate };