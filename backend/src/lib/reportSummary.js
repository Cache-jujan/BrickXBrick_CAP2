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

// A project is marked "watch" when the share of its budget already spent is
// more than this many percentage points ahead of the share of its work done
// (milestone progress). Spending running ahead of the work is the early sign
// of an overrun, before the budget is actually gone.
const WATCH_GAP_POINTS = 10;

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

// Every figure that compares spend with the budget uses spend TO DATE (all
// approved spend up to the end date), so budget left, % used and the status
// always agree. Period spend is its own figure: what was spent between the
// two dates.
function figures(budgetCents, periodCents, cumulativeCents, birCents, progressPct) {
  const usedPct = percent(cumulativeCents, budgetCents);
  const overrun = cumulativeCents > budgetCents;
  const watch = !overrun && usedPct !== null && progressPct !== null && usedPct - progressPct > WATCH_GAP_POINTS;
  return {
    budget: toPesos(budgetCents),
    periodSpend: toPesos(periodCents),
    cumulativeSpend: toPesos(cumulativeCents),
    birDeductibleSpend: toPesos(birCents),
    // Net P&L = budget minus spend to date ("budget left"). Negative is an overrun.
    netPnL: toPesos(budgetCents - cumulativeCents),
    // Period spend minus budget. Kept so older readers of the JSON still find
    // it; the Reports page and the PDF no longer show it (a slice of a
    // project's spend against its whole budget says nothing on its own).
    costVariance: toPesos(periodCents - budgetCents),
    // Cost variance to date: spend to date minus the budget. Negative is under
    // budget, positive is over (the same figure as netPnL, sign flipped).
    varianceToDate: toPesos(cumulativeCents - budgetCents),
    varianceToDatePct: percent(cumulativeCents - budgetCents, budgetCents),
    utilizationPct: percent(periodCents, budgetCents),
    cumulativeUtilizationPct: usedPct,
    // Work done: average milestone completion (0-100), or null when the
    // project has no milestones yet. It is the progress when the report is
    // generated, not as of the end date (milestones keep no history).
    progressPct,
    overrun,
    // "over" (spend to date above budget), "watch" (budget used more than
    // WATCH_GAP_POINTS ahead of work done) or "ok".
    health: overrun ? "over" : watch ? "watch" : "ok",
  };
}

// Milestone progress as a number to 2 decimals, or null when there is none.
function progressOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

// Work done for several projects together: weighted by budget, so a big
// project counts for more than a small one (a small project at 100% says
// little about the whole). Projects without milestones are left out.
function combinedProgress(buckets) {
  const known = buckets.filter((bucket) => bucket.progressPct !== null);
  if (known.length === 0) return null;
  const weight = known.reduce((total, bucket) => total + bucket.budgetCents, 0);
  const value =
    weight > 0
      ? known.reduce((total, bucket) => total + bucket.progressPct * bucket.budgetCents, 0) / weight
      : known.reduce((total, bucket) => total + bucket.progressPct, 0) / known.length;
  return Math.round(value * 100) / 100;
}

// Every calendar month the period touches, as YYYY-MM, oldest first.
function monthsBetween(from, to) {
  const months = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const last = to.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    months.push(key);
    if (key >= last) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

/**
 * buildSummary(projects, spendRows, warningRows, now, period)
 *
 * projects:    [{ projectId, name, budget, progress? }]
 *              progress: average milestone completion 0-100, null/absent = no milestones
 * spendRows:   [{ projectId, amount, receiptDate, birValidationStatus }]
 *              approved expenses only, receiptDate <= period.to
 * warningRows: [{ status, fraudFlagged }] expenses inside the period,
 *              any status (drives the integrity warning)
 * now:         Date, the freshness stamp (generatedAt)
 * period:      { from, to } as YYYY-MM-DD, inclusive
 */
function buildSummary(projects, spendRows, warningRows, now, period) {
  const { from, to } = period;
  const months = monthsBetween(from, to);
  const monthIndex = new Map(months.map((month, index) => [month, index]));

  const perProject = new Map(
    projects.map((project) => [
      project.projectId,
      {
        project,
        budgetCents: toCents(project.budget, `budget of ${project.name}`),
        periodCents: 0,
        cumulativeCents: 0,
        birCents: 0,
        monthCents: months.map(() => 0),
        progressPct: progressOf(project.progress),
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
      bucket.monthCents[monthIndex.get(day.slice(0, 7))] += cents;
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

  const totalMonthCents = months.map((_, index) => buckets.reduce((total, bucket) => total + bucket.monthCents[index], 0));

  const totals = figures(sum("budgetCents"), sum("periodCents"), sum("cumulativeCents"), sum("birCents"), combinedProgress(buckets));
  // Work done for the whole selection only covers projects that have
  // milestones, so "watch" compares it with the budget used by those same
  // projects, not by all of them.
  if (totals.health !== "over") {
    const known = buckets.filter((bucket) => bucket.progressPct !== null);
    const knownUsed = percent(
      known.reduce((total, bucket) => total + bucket.cumulativeCents, 0),
      known.reduce((total, bucket) => total + bucket.budgetCents, 0)
    );
    const ahead = knownUsed !== null && totals.progressPct !== null && knownUsed - totals.progressPct > WATCH_GAP_POINTS;
    totals.health = ahead ? "watch" : "ok";
  }

  return {
    generatedAt: now.toISOString(),
    period: { from, to },
    empty: periodRowCount === 0,
    watchGapPoints: WATCH_GAP_POINTS,
    // The months of the period; every monthlySpend list below lines up with it.
    months,
    projects: buckets.map((bucket) => ({
      projectId: bucket.project.projectId,
      name: bucket.project.name,
      ...figures(bucket.budgetCents, bucket.periodCents, bucket.cumulativeCents, bucket.birCents, bucket.progressPct),
      monthlySpend: bucket.monthCents.map(toPesos),
    })),
    totals: { ...totals, monthlySpend: totalMonthCents.map(toPesos) },
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

// progress: average milestone completion, the same figure the project page
// shows; NULL (not 0) when the project has no milestones yet.
async function loadProjects(queryFn, projectIds) {
  const result = await queryFn(
    `SELECT p.projectid AS "projectId", p.name, p.budget::text AS budget,
            (SELECT ROUND(AVG(m.completionpercentage), 2)::text
               FROM milestones m WHERE m.projectid = p.projectid) AS progress
       FROM projects p
      WHERE p.projectid = ANY($1::uuid[])`,
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
  WATCH_GAP_POINTS,
};
