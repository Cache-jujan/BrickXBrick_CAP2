// allocationPlan.js — F8 split logic as a pure function (no database).
//
// One receipt line is split across the open Material Requests for that
// material, oldest request first. A request never receives more than its
// remaining quantity. Whatever no request covers blocks the submit
// (UC-06-01 E3: no request, no purchase).
//
// Units: centavos for money, hundredths for quantity (see allocationValidation.js).

const { parseAllocationLines, httpError } = require("./allocationValidation");

// Jan's shared matcher (F9). Required lazily so this file still loads, and its
// tests still run with a fake matcher, before materialMatch.js is on develop.
function defaultMatcher(description, materialType) {
  return require("./materialMatch").matchesMaterial(description, materialType);
}

// DECIMAL columns come back from node-postgres as strings ("20.00").
// Number() first, then round to whole hundredths / centavos.
function toHundredths(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw httpError(500, `${fieldName} is not a valid quantity`);
  }
  return Math.round(number * 100);
}

function toCents(value) {
  if (value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function ticketTime(ticket) {
  const time = new Date(ticket.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

// Oldest request first; ticketID breaks ties (same order as the SQL ORDER BY).
function compareTickets(a, b) {
  const byTime = ticketTime(a) - ticketTime(b);
  if (byTime !== 0) return byTime;
  if (a.ticketID < b.ticketID) return -1;
  if (a.ticketID > b.ticketID) return 1;
  return 0;
}

// floor(lineCents * pieceQtyH / lineQtyH), done in BigInt so a large peso
// amount times a large quantity can't lose precision.
function proportionalCents(lineCents, pieceQtyH, lineQtyH) {
  return Number((BigInt(lineCents) * BigInt(pieceQtyH)) / BigInt(lineQtyH));
}

/**
 * planAllocation(lineItems, openTickets, options = {}, matches = matchesMaterial)
 *
 * lineItems:   [{ description, quantity, amount }] in receipt order, pesos
 * openTickets: [{ ticketID, projectID, projectName, materialType,
 *                 remainingQuantity, createdAt, remainingBudget? }]
 * options:     { excludeTicketIDs: [], feeTargets: { lineIndex: ticketID } }
 * matches:     (description, materialType) => boolean; tests pass a fake one
 *
 * Returns { ok, portions, uncovered, unmatched, allocatedCents, linesCents, warnings }
 */
function planAllocation(lineItems, openTickets, options = {}, matches = defaultMatcher) {
  // Step 1. Validate lines and convert to centavos / hundredths.
  const lines = parseAllocationLines(lineItems);
  const excluded = new Set((options.excludeTicketIDs || []).map((id) => String(id).toLowerCase()));
  const feeTargets = options.feeTargets || {};

  // Step 2. Drop excluded tickets, sort oldest first, and copy each remaining
  // quantity into a working map so lines of the same material share one pool.
  const tickets = (openTickets || [])
    .map((ticket) => ({
      ...ticket,
      ticketID: String(ticket.ticketID).toLowerCase(),
      remainingH: toHundredths(ticket.remainingQuantity, `ticket ${ticket.ticketID} remainingQuantity`),
      remainingBudgetCents: toCents(ticket.remainingBudget),
    }))
    .filter((ticket) => !excluded.has(ticket.ticketID))
    .sort(compareTickets);

  const leftH = new Map(tickets.map((ticket) => [ticket.ticketID, ticket.remainingH]));
  const portionsByTicket = new Map();
  const uncovered = [];
  const unmatched = [];

  function portionFor(ticket) {
    if (!portionsByTicket.has(ticket.ticketID)) {
      portionsByTicket.set(ticket.ticketID, {
        ticketID: ticket.ticketID,
        projectID: ticket.projectID,
        projectName: ticket.projectName,
        materialType: ticket.materialType,
        lines: [],
        amountCents: 0,
        quantityH: 0,
        startRemainingH: ticket.remainingH,
        remainingBudgetCents: ticket.remainingBudgetCents,
      });
    }
    return portionsByTicket.get(ticket.ticketID);
  }

  // Step 3. Material lines (quantity > 0), in receipt order.
  for (const line of lines) {
    if (line.quantityH === 0) continue;

    const matching = tickets.filter((ticket) => matches(line.description, ticket.materialType));

    // 3b. No open request for this material at all.
    if (matching.length === 0) {
      unmatched.push({
        lineIndex: line.lineIndex,
        description: line.description,
        quantityH: line.quantityH,
        amountCents: line.amountCents,
      });
      continue;
    }

    // 3c. Walk the matching requests, oldest first.
    let left = line.quantityH;
    const pieces = [];
    for (const ticket of matching) {
      if (left === 0) break;
      const available = leftH.get(ticket.ticketID);
      if (available === 0) continue;
      const take = Math.min(left, available);
      pieces.push({ ticket, quantityH: take });
      leftH.set(ticket.ticketID, available - take);
      left -= take;
    }

    // 3d. More than the requests cover: an uncovered piece, priced last.
    if (left > 0) pieces.push({ ticket: null, quantityH: left });

    // 3e. Price the pieces; the last piece takes the remainder (rule 8).
    let pricedCents = 0;
    pieces.forEach((piece, index) => {
      const isLast = index === pieces.length - 1;
      piece.amountCents = isLast
        ? line.amountCents - pricedCents
        : proportionalCents(line.amountCents, piece.quantityH, line.quantityH);
      pricedCents += piece.amountCents;
    });

    for (const piece of pieces) {
      if (piece.ticket === null) {
        uncovered.push({
          lineIndex: line.lineIndex,
          description: line.description,
          quantityH: piece.quantityH,
          amountCents: piece.amountCents,
        });
        continue;
      }
      const portion = portionFor(piece.ticket);
      portion.lines.push({
        lineIndex: line.lineIndex,
        description: line.description,
        quantityH: piece.quantityH,
        amountCents: piece.amountCents,
      });
      portion.quantityH += piece.quantityH;
      portion.amountCents += piece.amountCents;
    }
  }

  // Portions in request order, so "first portion" means the oldest request.
  const orderedPortions = () =>
    tickets.filter((ticket) => portionsByTicket.has(ticket.ticketID)).map((ticket) => portionsByTicket.get(ticket.ticketID));

  // Step 4. Fee / VAT / delivery lines (quantity 0) ride on a portion.
  for (const line of lines) {
    if (line.quantityH !== 0) continue;
    const portions = orderedPortions();
    if (portions.length === 0) {
      unmatched.push({
        lineIndex: line.lineIndex,
        description: line.description,
        quantityH: 0,
        amountCents: line.amountCents,
      });
      continue;
    }
    const target = portionsByTicket.get(feeTargets[line.lineIndex]) || portions[0];
    target.lines.push({
      lineIndex: line.lineIndex,
      description: line.description,
      quantityH: 0,
      amountCents: line.amountCents,
    });
    target.amountCents += line.amountCents;
  }

  // Step 5. Finish each portion and build the result.
  const warnings = [];
  const portions = orderedPortions().map((portion) => {
    const remainingAfterH = portion.startRemainingH - portion.quantityH;
    const overBudget =
      portion.remainingBudgetCents !== null && portion.amountCents > portion.remainingBudgetCents;
    if (overBudget) {
      warnings.push({
        type: "OVER_BUDGET",
        ticketID: portion.ticketID,
        amountCents: portion.amountCents,
        remainingBudgetCents: portion.remainingBudgetCents,
      });
    }
    return {
      ticketID: portion.ticketID,
      projectID: portion.projectID,
      projectName: portion.projectName,
      materialType: portion.materialType,
      lines: portion.lines.sort((a, b) => a.lineIndex - b.lineIndex),
      amountCents: portion.amountCents,
      quantityH: portion.quantityH,
      remainingAfterH,
      resolvesTicket: remainingAfterH === 0,
      remainingBudgetCents: portion.remainingBudgetCents,
      overBudget,
    };
  });

  const allocatedCents = portions.reduce((sum, portion) => sum + portion.amountCents, 0);
  const linesCents = lines.reduce((sum, line) => sum + line.amountCents, 0);

  return {
    ok: uncovered.length === 0 && unmatched.length === 0 && portions.length >= 2,
    portions,
    uncovered,
    unmatched,
    allocatedCents,
    linesCents,
    warnings,
  };
}

// Plain-language reasons a plan can't be submitted, for the 400 response
// and the Allocate screen. Empty array when plan.ok is true.
function describePlanProblems(plan) {
  const problems = [];
  const qty = (quantityH) => String(quantityH / 100);
  for (const piece of plan.unmatched) {
    problems.push(
      piece.quantityH === 0
        ? `"${piece.description}" has no portion to ride on because no line matched an open request.`
        : `No open request for ${qty(piece.quantityH)} of "${piece.description}". Ask the Site Manager to file one.`
    );
  }
  for (const piece of plan.uncovered) {
    problems.push(
      `No open request for ${qty(piece.quantityH)} more of "${piece.description}". Ask the Site Manager to file one.`
    );
  }
  if (plan.uncovered.length === 0 && plan.unmatched.length === 0 && plan.portions.length < 2) {
    problems.push("This receipt covers one request. Submit it from that request instead.");
  }
  return problems;
}

module.exports = { planAllocation, describePlanProblems, compareTickets };
