// reportBreakdown.js: F11 "View breakdown". The rows behind every figure on
// the report, so the General Manager can see HOW a number was reached, not
// only the number.
//
// Same rules as reportSummary.js, on purpose, so the rows always add up to
// the figure that was clicked:
//   - spend = APPROVED expenses with a receipt date up to `to` (decision D1);
//     inPeriod marks the ones from `from` to `to` ("Spent in this period").
//   - work done = the average of the project's milestone completion %.
//   - excluded = expenses in the period that are still Pending, or carry an
//     unresolved fraud flag (the same rule as the "figures may change" banner).
// Read-only: nothing is written, and the blockchain is not touched.

const { manilaToday } = require("./bomRules");

// A pg DATE may arrive as text or as a Date at local midnight: keep the day.
function dayText(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

/**
 * Pure: turns the loaded rows into the breakdown for each project.
 * asOf: the day overdue is judged on, the report's end date but never later
 * than today (a future end date must not make milestones look overdue).
 */
function buildBreakdown({ projects, expenses, milestones, excluded }, { from, to }, today) {
  const asOf = to < today ? to : today;
  const byProject = (rows) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.projectId)) map.set(row.projectId, []);
      map.get(row.projectId).push(row);
    }
    return map;
  };
  const expensesOf = byProject(expenses);
  const milestonesOf = byProject(milestones);
  const excludedOf = byProject(excluded);

  return {
    period: { from, to },
    asOf,
    projects: projects.map((p) => {
      const rows = (expensesOf.get(p.projectId) || [])
        .map((e) => {
          const receiptDate = dayText(e.receiptDate);
          return {
            expenseId: e.expenseId,
            receiptDate,
            vendorName: e.vendorName,
            birValidationStatus: e.birValidationStatus,
            amount: toNumber(e.amount),
            inPeriod: receiptDate >= from && receiptDate <= to,
          };
        })
        .sort((a, b) => (a.receiptDate === b.receiptDate ? 0 : a.receiptDate < b.receiptDate ? -1 : 1));
      const ms = (milestonesOf.get(p.projectId) || [])
        .map((m) => {
          const dueDate = dayText(m.dueDate);
          const completion = toNumber(m.completion);
          return { name: m.name, dueDate, completion, overdue: dueDate !== null && dueDate < asOf && completion < 100 };
        })
        .sort((a, b) => (a.dueDate === b.dueDate ? 0 : a.dueDate < b.dueDate ? -1 : 1));
      const left = (excludedOf.get(p.projectId) || []).map((x) => ({
        expenseId: x.expenseId,
        receiptDate: dayText(x.receiptDate),
        vendorName: x.vendorName,
        amount: toNumber(x.amount),
        status: x.status,
        fraudFlagged: Boolean(x.fraudFlagged),
      }));
      return { projectId: p.projectId, name: p.name, budget: toNumber(p.budget), expenses: rows, milestones: ms, excluded: left };
    }),
  };
}

async function loadBreakdownRows(queryFn, { projectIds, from, to }) {
  const [projects, expenses, milestones, excluded] = await Promise.all([
    queryFn(
      `SELECT p.projectid AS "projectId", p.name, p.budget::text AS budget
         FROM projects p WHERE p.projectid = ANY($1::uuid[])`,
      [projectIds]
    ),
    queryFn(
      `SELECT e.expenseid AS "expenseId", e.projectid AS "projectId",
              e.receiptdate::text AS "receiptDate", e.vendorname AS "vendorName",
              e.birvalidationstatus AS "birValidationStatus", e.amount::text AS amount
         FROM expenses e
        WHERE e.status = 'Approved'
          AND e.projectid = ANY($1::uuid[])
          AND e.receiptdate <= $2::date`,
      [projectIds, to]
    ),
    queryFn(
      `SELECT m.projectid AS "projectId", m.name, m.duedate::text AS "dueDate",
              m.completionpercentage::text AS completion
         FROM milestones m WHERE m.projectid = ANY($1::uuid[])`,
      [projectIds]
    ),
    queryFn(
      `SELECT e.expenseid AS "expenseId", e.projectid AS "projectId",
              e.receiptdate::text AS "receiptDate", e.vendorname AS "vendorName",
              e.amount::text AS amount, e.status,
              EXISTS (SELECT 1 FROM fraudflags f
                       WHERE f.expenseid = e.expenseid AND f.resolution = 'Pending') AS "fraudFlagged"
         FROM expenses e
        WHERE e.projectid = ANY($1::uuid[])
          AND e.receiptdate BETWEEN $2::date AND $3::date
          AND e.status <> 'Rejected'`,
      [projectIds, from, to]
    ),
  ]);
  return {
    projects: projects.rows,
    expenses: expenses.rows,
    milestones: milestones.rows,
    // Same rule as reportSummary.loadWarningRows.
    excluded: excluded.rows.filter((row) => row.status === "Pending" || row.fraudFlagged),
  };
}

async function getReportBreakdown(queryFn, { projectIds, from, to }, today = manilaToday()) {
  const rows = await loadBreakdownRows(queryFn, { projectIds, from, to });
  // Keep the order the GM chose.
  const order = new Map(projectIds.map((id, i) => [id, i]));
  rows.projects.sort((a, b) => (order.get(a.projectId) ?? 0) - (order.get(b.projectId) ?? 0));
  return buildBreakdown(rows, { from, to }, today);
}

module.exports = { buildBreakdown, getReportBreakdown, loadBreakdownRows };
