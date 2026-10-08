// openRequests.js — the open Material Requests a split receipt can fill.
//
// An open request is an Acknowledged Material Request whose remaining
// quantity is above 0:
//   remaining = tickets.quantity - quantity of its expenses that aren't Rejected
// A request can be filled across several receipts, so we always subtract
// what was already charged.
//
// Who sees which requests (UC-08-01 actors):
//   Purchaser       -> requests assigned to them
//   Project Manager -> requests on projects they manage (backup actor)
//   General Manager -> every open request (backup actor)

const { query } = require("./db");

const ALLOCATION_ROLES = ["Purchaser", "Project Manager", "General Manager"];

// Returns the WHERE fragment and params that scope tickets to this user.
// Kept separate so the lock in POST /api/allocations uses the same scope.
function ticketScope(user) {
  if (!user || !ALLOCATION_ROLES.includes(user.role)) {
    const error = new Error("Only the Purchaser, Project Manager or General Manager can split a receipt");
    error.status = 403;
    throw error;
  }
  if (user.role === "Purchaser") return { clause: "t.assignedto = $1", params: [user.id] };
  if (user.role === "Project Manager") return { clause: "p.projectmanagerid = $1", params: [user.id] };
  return { clause: "TRUE", params: [] };
}

function buildOpenRequestsQuery(user) {
  const scope = ticketScope(user);
  const text = `
    SELECT t.ticketid      AS "ticketID",
           t.projectid     AS "projectID",
           p.name          AS "projectName",
           t.subject,
           t.materialtype  AS "materialType",
           t.vendorname    AS "vendorName",
           t.quantity      AS "requestedQuantity",
           t.approvedbudget AS "approvedBudget",
           t.createdat     AS "createdAt",
           t.quantity - COALESCE(SUM(e.quantity) FILTER (WHERE e.status <> 'Rejected'), 0) AS "remainingQuantity",
           t.approvedbudget - COALESCE(SUM(e.amount) FILTER (WHERE e.status <> 'Rejected'), 0) AS "remainingBudget"
      FROM tickets t
      JOIN projects p ON p.projectid = t.projectid
      LEFT JOIN expenses e ON e.ticketid = t.ticketid
     WHERE ${scope.clause}
       AND t.tickettype = 'Material Request'
       AND t.status = 'Acknowledged'
       AND t.materialtype IS NOT NULL
       AND t.quantity IS NOT NULL
     GROUP BY t.ticketid, p.name
    HAVING t.quantity - COALESCE(SUM(e.quantity) FILTER (WHERE e.status <> 'Rejected'), 0) > 0
     ORDER BY t.createdat, t.ticketid`;
  return { text, params: scope.params };
}

// The row lock for POST /api/allocations. Postgres won't combine FOR UPDATE
// with GROUP BY, so we lock the ticket rows first, then run the grouped query
// with the same client. A second split of the same requests waits here.
function buildLockQuery(user) {
  const scope = ticketScope(user);
  const text = `
    SELECT t.ticketid
      FROM tickets t
      JOIN projects p ON p.projectid = t.projectid
     WHERE ${scope.clause}
       AND t.tickettype = 'Material Request'
       AND t.status = 'Acknowledged'
     ORDER BY t.ticketid
       FOR UPDATE OF t`;
  return { text, params: scope.params };
}

// node-postgres returns DECIMAL as strings. Convert for the API and the plan.
function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function loadOpenRequests(user, client) {
  const { text, params } = buildOpenRequestsQuery(user);
  const result = client ? await client.query(text, params) : await query(text, params);
  return result.rows.map((row) => ({
    ...row,
    requestedQuantity: toNumberOrNull(row.requestedQuantity),
    remainingQuantity: toNumberOrNull(row.remainingQuantity),
    approvedBudget: toNumberOrNull(row.approvedBudget),
    remainingBudget: toNumberOrNull(row.remainingBudget),
  }));
}

module.exports = { ALLOCATION_ROLES, ticketScope, buildOpenRequestsQuery, buildLockQuery, loadOpenRequests };
