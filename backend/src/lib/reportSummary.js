// reportSummary.js — F11 summary math as a pure function (no database).
//
// The SQL loader (added in R4) returns plain rows; buildSummary turns them
// into the figures on the Reports page and the PDF. Money is added up in whole
// centavos, so 0.1 + 0.2 style drift cannot happen, and converted back to
// pesos (2 decimals) only at the edge.
//
// Spend rule (docs/decisions-and-learnings.md D1): spendRows are APPROVED
// expenses, one row per expense. A split receipt is already one expense per
// project portion, so each row is counted exactly once.

const FORMAL = "Formal-Tax-Deductible";

function toCents(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${fieldName} is not a valid amount`);
  }
  return Math.round(number * 100);
}

const toPesos = (cents) => cents / 100;

// Receipt dates compare as YYYY-MM-DD text, so server timezone never matters.
function dayOf(value) {
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

// part / whole * 100 to 2 decimals, or null when whole is 0 (no Infinity).
function percent(partCents, wholeCents) {
  if (wholeCents === 0) return null;
  return Math.round((partCents * 10000) / wholeCents) / 100;
}

function figures(budgetCents, periodCents, cumulativeCents, birCents) {
  return {
    budget: toPesos(budgetCents),
    periodSpend: toPesos(periodCents),
    cumulativeSpend: toPesos(cumulativeCents),
    birDeductibleSpend: toPesos(birCents),
    netPnL: toPesos(budgetCents - periodCents),
    costVariance: toPesos(periodCents - budgetCents),
    utilizationPct: percent(periodCents, budgetCents),
    cumulativeUtilizationPct: percent(cumulativeCents, budgetCents),
    overrun: periodCents > budgetCents,
  };
}

/**
 * buildSummary(projects, spendRows, warningRows, now, period)
 *
 * projects:    [{ projectId, name, budget }]
 * spendRows:   [{ projectId, amount, receiptDate, birValidationStatus }]
 *              approved expenses only, receiptDate <= period.to
 * warningRows: [{ status, fraudFlagged }] expenses inside the period,
 *              any status (drives the integrity warning)
 * now:         Date, the freshness stamp (generatedAt)
 * period:      { from, to } as YYYY-MM-DD, inclusive
 */
function buildSummary(projects, spendRows, warningRows, now, period) {
  const { from, to } = period;

  const perProject = new Map(
    projects.map((project) => [
      project.projectId,
      {
        project,
        budgetCents: toCents(project.budget, `budget of ${project.name}`),
        periodCents: 0,
        cumulativeCents: 0,
        birCents: 0,
      },
    ])
  );

  let periodRowCount = 0;
  for (const row of spendRows) {
    const bucket = perProject.get(row.projectId);
    if (!bucket) continue; // a project that was not asked for
    const day = dayOf(row.receiptDate);
    if (day > to) continue;
    const cents = toCents(row.amount, "expense amount");
    bucket.cumulativeCents += cents;
    if (day >= from) {
      bucket.periodCents += cents;
      periodRowCount += 1;
      if (row.birValidationStatus === FORMAL) bucket.birCents += cents;
    }
  }

  const buckets = [...perProject.values()];
  const sum = (key) => buckets.reduce((total, bucket) => total + bucket[key], 0);

  const warnings = {
    pendingExpenses: warningRows.filter((row) => row.status === "Pending").length,
    fraudFlaggedExpenses: warningRows.filter((row) => row.fraudFlagged).length,
  };

  return {
    generatedAt: now.toISOString(),
    period: { from, to },
    empty: periodRowCount === 0,
    projects: buckets.map((bucket) => ({
      projectId: bucket.project.projectId,
      name: bucket.project.name,
      ...figures(bucket.budgetCents, bucket.periodCents, bucket.cumulativeCents, bucket.birCents),
    })),
    totals: figures(sum("budgetCents"), sum("periodCents"), sum("cumulativeCents"), sum("birCents")),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// SQL loaders. queryFn is (text, params) => { rows }, so tests pass a fake.
// DECIMAL and DATE columns are cast to text in SQL: amounts arrive exact and
// dates arrive as YYYY-MM-DD, with no server-timezone Date objects.
// ---------------------------------------------------------------------------

function httpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

async function loadProjects(queryFn, projectIds) {
  const result = await queryFn(
    `SELECT projectid AS "projectId", name, budget::text AS budget
       FROM projects
      WHERE projectid = ANY($1::uuid[])`,
    [projectIds]
  );
  return result.rows;
}

// The ONE place that decides what counts as spend (decision D1): approved
// expenses, one row each. receiptallocations is deliberately not read.
async function loadSpendRows(queryFn, { projectIds, to }) {
  const result = await queryFn(
    `SELECT projectid AS "projectId",
            amount::text AS amount,
            receiptdate::text AS "receiptDate",
            birvalidationstatus AS "birValidationStatus"
       FROM expenses
      WHERE status = 'Approved'
        AND projectid = ANY($1::uuid[])
        AND receiptdate <= $2::date`,
    [projectIds, to]
  );
  return result.rows;
}

// Expenses inside the range that the numbers do NOT yet reflect (still
// Pending) or that carry an unresolved fraud flag.
async function loadWarningRows(queryFn, { projectIds, from, to }) {
  const result = await queryFn(
    `SELECT e.status,
            EXISTS (SELECT 1 FROM fraudflags f
                     WHERE f.expenseid = e.expenseid AND f.resolution = 'Pending') AS "fraudFlagged"
       FROM expenses e
      WHERE e.projectid = ANY($1::uuid[])
        AND e.receiptdate BETWEEN $2::date AND $3::date
        AND e.status <> 'Rejected'`,
    [projectIds, from, to]
  );
  return result.rows.filter((row) => row.status === "Pending" || row.fraudFlagged);
}

// Load everything and build the summary. Shared by the JSON route and the
// PDF route, so both always show the same numbers.
async function getReportSummary(queryFn, { projectIds, from, to }, now = new Date()) {
  const projects = await loadProjects(queryFn, projectIds);
  const found = new Set(projects.map((project) => project.projectId));
  const missing = projectIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw httpError(400, `Unknown project id: ${missing.join(", ")}`, {
      fieldErrors: [{ field: "projectIds", message: `Unknown project id: ${missing.join(", ")}` }],
    });
  }
  // Keep the order the caller asked for.
  const ordered = projectIds.map((id) => projects.find((project) => project.projectId === id));
  const [spendRows, warningRows] = await Promise.all([
    loadSpendRows(queryFn, { projectIds, to }),
    loadWarningRows(queryFn, { projectIds, from, to }),
  ]);
  return buildSummary(ordered, spendRows, warningRows, now, { from, to });
}

module.exports = {
  buildSummary,
  getReportSummary,
  loadProjects,
  loadSpendRows,
  loadWarningRows,
  FORMAL,
};
