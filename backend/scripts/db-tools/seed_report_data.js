// seed_report_data.js — F11 demo/test data with known totals.
//
// Creates two Active projects ("F11 Seed A", "F11 Seed B"), a General Manager
// and a Project Manager account row, and ~9 expenses across statuses, mixed
// Formal/Informal, dated inside and outside the test range, plus ONE split
// receipt. Prints the expected figures for 2026-10-01 .. 2026-10-31 so you can
// compare them by eye with GET /api/reports/summary.
//
// The split is built with planAllocation (the same function POST
// /api/allocations uses) and the same two INSERTs the route runs, so
// allocations.js stays untouched (decision D1 in docs/decisions-and-learnings.md).
//
// Safe to re-run: it deletes its own earlier rows first.
// Refuses to run against Neon.
//
// Usage (from backend/):  DATABASE_URL=postgresql://... node scripts/db-tools/seed_report_data.js

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const crypto = require("crypto");
const { Client } = require("pg");
const { planAllocation } = require("../../src/lib/allocationPlan");
const { formatMoney } = require("../../src/lib/allocationValidation");

const RANGE = { from: "2026-10-01", to: "2026-10-31" };
const FORMAL = "Formal-Tax-Deductible";
const INFORMAL = "Informal";

async function main() {
  const url = process.env.DATABASE_URL || "";
  if (!url) throw new Error("DATABASE_URL is not set");
  if (/neon\.tech|neon\.build/i.test(url)) {
    throw new Error("Refusing to seed a Neon database. Point DATABASE_URL at the local Postgres.");
  }

  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("BEGIN");
    await clearPreviousSeed(db);

    const gm = await upsertUser(db, "f11seedgm@gmail.com", "F11 Seed GM", "General Manager");
    const pm = await upsertUser(db, "f11seedpm@gmail.com", "F11 Seed PM", "Project Manager");

    const projectA = await insertProject(db, gm, pm, "F11 Seed A", "100000.00");
    const projectB = await insertProject(db, gm, pm, "F11 Seed B", "50000.00");

    // [project, amount, receiptDate, status, bir]
    const plain = [
      [projectA, "20000.00", "2026-10-05", "Approved", FORMAL],
      [projectA, "15000.50", "2026-10-12", "Approved", INFORMAL], // gets an unresolved fraud flag
      [projectA, "8000.00", "2026-10-20", "Pending", FORMAL], // not spend yet: warning
      [projectA, "5000.00", "2026-10-15", "Rejected", FORMAL], // never spend
      [projectA, "12000.00", "2026-09-20", "Approved", FORMAL], // before range: cumulative only
      [projectA, "3000.00", "2026-11-05", "Approved", INFORMAL], // after range: ignored
      [projectB, "30000.00", "2026-10-03", "Approved", FORMAL],
      [projectB, "25000.00", "2026-10-25", "Approved", INFORMAL],
    ];
    const expenses = [];
    for (const [project, amount, receiptDate, status, bir] of plain) {
      const id = await insertExpense(db, { project, submittedBy: pm, approvedBy: status === "Approved" ? pm : null, amount, receiptDate, status, bir, quantity: "1.00", lineItems: [] });
      expenses.push({ id, project, amount, receiptDate, status, bir });
    }
    await db.query(
      `INSERT INTO fraudflags (expenseid, flaggedby, flagtype, reason) VALUES ($1, 'system', 'BIR_Duplicate', 'seed: unresolved flag')`,
      [expenses[1].id]
    );

    // The split receipt: 45 bags, PHP 4,500, two open requests (20 + 25 left).
    const splitDate = "2026-10-18";
    const plan = planAllocation(
      [{ description: "Portland cement 40kg", quantity: 45, amount: 4500 }],
      [
        { ticketID: crypto.randomUUID(), projectID: projectA, projectName: "F11 Seed A", materialType: "Cement", remainingQuantity: "20.00", createdAt: "2026-10-01T00:00:00Z" },
        { ticketID: crypto.randomUUID(), projectID: projectB, projectName: "F11 Seed B", materialType: "Cement", remainingQuantity: "25.00", createdAt: "2026-10-02T00:00:00Z" },
      ],
      {},
      () => true // every line matches; the matching rule is not under test here
    );
    if (!plan.ok) throw new Error("Seed split plan failed: " + JSON.stringify(plan.uncovered));
    const commonReceiptID = crypto.randomUUID();
    for (const portion of plan.portions) {
      const amount = formatMoney(portion.amountCents);
      const id = await insertExpense(db, {
        project: portion.projectID, submittedBy: pm, approvedBy: pm, amount, receiptDate: splitDate,
        status: "Approved", bir: FORMAL, quantity: formatMoney(portion.quantityH),
        lineItems: portion.lines.map((l) => ({ description: l.description, quantity: l.quantityH / 100, amount: l.amountCents / 100 })),
      });
      await db.query(
        `INSERT INTO receiptallocations (expenseid, projectid, allocatedamount, commonreceiptid) VALUES ($1, $2, $3, $4)`,
        [id, portion.projectID, amount, commonReceiptID]
      );
      expenses.push({ id, project: portion.projectID, amount, receiptDate: splitDate, status: "Approved", bir: FORMAL });
    }
    await db.query("COMMIT");

    printExpected(
      [{ id: projectA, name: "F11 Seed A", budget: "100000.00" }, { id: projectB, name: "F11 Seed B", budget: "50000.00" }],
      expenses
    );
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

async function clearPreviousSeed(db) {
  const ids = (await db.query("SELECT projectid FROM projects WHERE name IN ('F11 Seed A', 'F11 Seed B')")).rows.map((r) => r.projectid);
  if (ids.length === 0) return;
  const expenseIds = (await db.query("SELECT expenseid FROM expenses WHERE projectid = ANY($1)", [ids])).rows.map((r) => r.expenseid);
  await db.query("DELETE FROM receiptallocations WHERE expenseid = ANY($1) OR projectid = ANY($2)", [expenseIds, ids]);
  await db.query("DELETE FROM fraudflags WHERE expenseid = ANY($1)", [expenseIds]);
  await db.query("DELETE FROM expenses WHERE projectid = ANY($1)", [ids]);
  await db.query("DELETE FROM projects WHERE projectid = ANY($1)", [ids]);
}

async function upsertUser(db, email, name, role) {
  const found = await db.query("SELECT userid FROM users WHERE email = $1", [email]);
  if (found.rowCount > 0) return found.rows[0].userid;
  const created = await db.query(
    "INSERT INTO users (name, email, supabaseuserid, role) VALUES ($1, $2, gen_random_uuid(), $3) RETURNING userid",
    [name, email, role]
  );
  return created.rows[0].userid;
}

async function insertProject(db, gm, pm, name, budget) {
  const r = await db.query(
    `INSERT INTO projects (createdby, name, clientname, status, startdate, budget, projectmanagerid, projecttype, municipality)
     VALUES ($1, $2, 'F11 Seed Client', 'Active', '2026-01-01', $3, $4, 'Other', 'Cebu City') RETURNING projectid`,
    [gm, name, budget, pm]
  );
  return r.rows[0].projectid;
}

async function insertExpense(db, e) {
  const r = await db.query(
    `INSERT INTO expenses
       (projectid, submittedby, approvedby, vendorname, amount, receiptdate, category,
        birvalidationstatus, receiptimageurl, status, quantity, lineitems)
     VALUES ($1, $2, $3, 'F11 Seed Vendor', $4, $5, 'Materials', $6, 'seed://f11', $7, $8, $9)
     RETURNING expenseid`,
    [e.project, e.submittedBy, e.approvedBy, e.amount, e.receiptDate, e.bir, e.status, e.quantity, JSON.stringify(e.lineItems)]
  );
  return r.rows[0].expenseid;
}

// Expected figures, worked out with a plain loop in whole centavos (not the
// code under test).
function printExpected(projects, expenses) {
  const cents = (v) => Math.round(Number(v) * 100);
  const peso = (c) => (c / 100).toFixed(2);
  console.log(`\nExpected for ${RANGE.from} .. ${RANGE.to}`);
  console.log("projectIds=" + projects.map((p) => p.id).join(","));
  let total = { budget: 0, period: 0 };
  for (const p of projects) {
    const mine = expenses.filter((e) => e.project === p.id && e.status === "Approved");
    const period = mine.filter((e) => e.receiptDate >= RANGE.from && e.receiptDate <= RANGE.to);
    const sum = (list) => list.reduce((t, e) => t + cents(e.amount), 0);
    const budget = cents(p.budget);
    const periodC = sum(period);
    total = { budget: total.budget + budget, period: total.period + periodC };
    console.log(
      `\n${p.name}  (${p.id})\n` +
        `  budget ${peso(budget)}  periodSpend ${peso(periodC)}  cumulativeSpend ${peso(sum(mine.filter((e) => e.receiptDate <= RANGE.to)))}\n` +
        `  birDeductibleSpend ${peso(sum(period.filter((e) => e.bir === FORMAL)))}  netPnL ${peso(budget - periodC)}  ` +
        `utilizationPct ${((periodC * 100) / budget).toFixed(2)}  overrun ${periodC > budget}`
    );
  }
  const inRange = expenses.filter((e) => e.receiptDate >= RANGE.from && e.receiptDate <= RANGE.to);
  console.log(`\nTOTAL budget ${peso(total.budget)}  periodSpend ${peso(total.period)}  netPnL ${peso(total.budget - total.period)}`);
  console.log(`warnings: pendingExpenses ${inRange.filter((e) => e.status === "Pending").length}, fraudFlaggedExpenses 1`);
  console.log("split receipt 4500.00 = 2000.00 (A) + 2500.00 (B), counted once.\n");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
