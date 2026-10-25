// allocationPlan.js — F8 split logic as a pure function (no database).
//
// One receipt line is split across the open Material Requests for that
// material, oldest request first. A request never receives more than its
// remaining quantity. Buying MORE than every open request wants is a fact, not
// an error (the money is already spent): the extra rides on the last request
// that took part of the line and is reported as an "extra" for the PM to judge.
// A line no request matches at all still blocks the submit (UC-06-01 E3).
//
// Units: centavos for money, hundredths for quantity (see allocationValidation.js).

const { parseAllocationLines, httpError, formatMoney } = require("./allocationValidation");

// One matching rule shared with F9 Layer 3 (Jan's helper). Tests inject a fake.
const { matchesMaterial } = require("./materialMatch");

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

// A PM-set tolerance over the budget given (delivery, gas, price changes).
const DEFAULT_ALLOWANCE_PCT = 10;

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
 * Returns { ok, portions, extras, unmatched, allocatedCents, linesCents, warnings }
 */
function planAllocation(lineItems, openTickets, options = {}, matches = matchesMaterial) {
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
  const extras = [];
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
        extraH: 0,
        allowancePct: Number.isFinite(Number(ticket.budgetAllowancePct)) ? Number(ticket.budgetAllowancePct) : DEFAULT_ALLOWANCE_PCT,
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

    // 3d. More than the requests want: an extra on the last request that took part
    // of this line (or the oldest match if none had room), priced last.
    if (left > 0) {
      const lastTaker = [...pieces].reverse().find((piece) => piece.ticket)?.ticket ?? matching[0];
      pieces.push({ ticket: lastTaker, quantityH: left, extra: true });
    }

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
      const portion = portionFor(piece.ticket);
      if (piece.extra) {
        portion.extraH += piece.quantityH;
        extras.push({
          lineIndex: line.lineIndex,
          description: line.description,
          quantityH: piece.quantityH,
          amountCents: piece.amountCents,
          ticketID: piece.ticket.ticketID,
        });
      }
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
    // Extras were bought beyond what was left, so they do not count against it.
    const remainingAfterH = Math.max(0, portion.startRemainingH - (portion.quantityH - portion.extraH));
    const overBudget =
      portion.remainingBudgetCents !== null && portion.amountCents > portion.remainingBudgetCents;
    // Beyond the PM's allowance the Purchaser must say why; inside it, it is normal.
    const overAllowance =
      overBudget &&
      portion.amountCents * 100 > portion.remainingBudgetCents * (100 + portion.allowancePct);
    if (overBudget) {
      warnings.push({
        type: "OVER_BUDGET",
        ticketID: portion.ticketID,
        amountCents: portion.amountCents,
        remainingBudgetCents: portion.remainingBudgetCents,
        overAllowance,
      });
    }
    if (portion.extraH > 0) {
      warnings.push({ type: "OVER_QUANTITY", ticketID: portion.ticketID, quantityH: portion.extraH });
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
      overAllowance,
      extraH: portion.extraH,
      allowancePct: portion.allowancePct,
    };
  });

  const allocatedCents = portions.reduce((sum, portion) => sum + portion.amountCents, 0);
  const linesCents = lines.reduce((sum, line) => sum + line.amountCents, 0);

  return {
    ok: unmatched.length === 0 && portions.length >= 1,
    portions,
    extras,
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
  if (plan.unmatched.length === 0 && plan.portions.length === 0) {
    problems.push("No open request matches anything on this receipt.");
  }
  return problems;
}

/**
 * The note saved on a portion's expense for the PM: what the system noticed
 * (extra quantity, spending beyond the allowance) and the Purchaser's own reason.
 * Null when there is nothing to say.
 */
function submitNoteFor(portion, userNote) {
  const parts = [];
  if (portion.extraH > 0) {
    parts.push(`Bought ${portion.extraH / 100} more ${portion.materialType} than requested.`);
  }
  if (portion.overAllowance) {
    parts.push(
      `Spent ₱${formatMoney(portion.amountCents)} with ₱${formatMoney(portion.remainingBudgetCents)} left, beyond the ${portion.allowancePct}% allowance.`
    );
  }
  if (userNote) parts.push(`Purchaser's reason: ${userNote}`);
  return parts.length ? parts.join(" ") : null;
}

// Plan -> API response: centavos become peso strings ("6100.00", the same
// shape Postgres DECIMAL columns return) and hundredths become numbers.
function presentPlan(plan) {
  const peso = (cents) => (cents === null || cents === undefined ? null : formatMoney(cents));
  const qty = (quantityH) => quantityH / 100;
  const presentLine = (line) => ({
    lineIndex: line.lineIndex,
    description: line.description,
    quantity: qty(line.quantityH),
    amount: peso(line.amountCents),
  });
  return {
    ok: plan.ok,
    problems: describePlanProblems(plan),
    portions: plan.portions.map((portion) => ({
      ticketID: portion.ticketID,
      projectID: portion.projectID,
      projectName: portion.projectName,
      materialType: portion.materialType,
      quantity: qty(portion.quantityH),
      amount: peso(portion.amountCents),
      remainingAfter: qty(portion.remainingAfterH),
      resolvesTicket: portion.resolvesTicket,
      remainingBudget: peso(portion.remainingBudgetCents),
      overBudget: portion.overBudget,
      overAllowance: portion.overAllowance,
      extraQuantity: qty(portion.extraH),
      lines: portion.lines.map(presentLine),
    })),
    // Always empty now: kept so older clients that read it keep working.
    uncovered: [],
    extras: plan.extras.map((line) => ({ ...presentLine(line), ticketID: line.ticketID })),
    unmatched: plan.unmatched.map(presentLine),
    allocated: peso(plan.allocatedCents),
    linesTotal: peso(plan.linesCents),
    warnings: plan.warnings.map((warning) =>
      warning.type === "OVER_QUANTITY"
        ? { type: warning.type, ticketID: warning.ticketID, quantity: qty(warning.quantityH) }
        : {
            type: warning.type,
            ticketID: warning.ticketID,
            amount: peso(warning.amountCents),
            remainingBudget: peso(warning.remainingBudgetCents),
            overAllowance: warning.overAllowance,
          }
    ),
  };
}

module.exports = { planAllocation, describePlanProblems, presentPlan, compareTickets, submitNoteFor };
