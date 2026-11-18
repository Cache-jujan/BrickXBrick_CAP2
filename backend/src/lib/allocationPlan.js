// allocationPlan.js: F8 split logic as a pure function (no database).
//
// One receipt line is split across the open Material Requests for that
// material, oldest request first. A request never receives more than its
// remaining quantity. Buying MORE than every open request wants leaves that
// quantity unmatched, exactly like a line no request matches at all: nothing is
// allocated without a request, so the submit is blocked until a request exists
// for it (UC-06-01 E3).
//
// Units: centavos for money, hundredths for quantity (see allocationValidation.js).

const { parseAllocationLines, httpError, formatMoney } = require("./allocationValidation");

// One matching rule shared with F9 Layer 3 (Jan's helper). Tests inject a fake.
const { matchesMaterial } = require("./materialMatch");

// Quantities are kept as whole hundredths (the "H" in quantityH / remainingH) and money as whole
// centavos (the "Cents" in amountCents). 2.5 bags is 250, so splitting a receipt across requests
// is integer math and never loses a fraction to float error.
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
 * options:     { excludeTicketIDs: [], feeTargets: { lineIndex: ticketID },
 *                lineTargets: { lineIndex: ticketID } }   (a line matched to a request by hand)
 * matches:     (description, materialType) => boolean; tests pass a fake one
 *
 * Returns { ok, portions, extras, unmatched, allocatedCents, linesCents, warnings }
 */
function planAllocation(lineItems, openTickets, options = {}, matches = matchesMaterial) {
  // Step 1. Validate lines and convert to centavos / hundredths.
  const lines = parseAllocationLines(lineItems);
  const excluded = new Set((options.excludeTicketIDs || []).map((id) => String(id).toLowerCase()));
  const feeTargets = options.feeTargets || {};
  const lineTargets = options.lineTargets || {};
  // { lineIndex: { ticketID: quantityH } } typed by the Purchaser; a line with an entry here is split exactly so.
  const quantityTargets = options.quantityTargets || {};

  // Every open request that asks for something on this receipt, whether or not it is ticked or reached
  // by the split. The app lists all of them so the Purchaser can tick the ones the receipt belongs to.
  const candidates = (openTickets || []).flatMap((ticket) => {
    const id = String(ticket.ticketID).toLowerCase();
    const lineIndexes = lines
      .filter((line) => line.quantityH > 0)
      .filter((line) => (lineTargets[line.lineIndex] ? lineTargets[line.lineIndex] === id : matches(line.description, ticket.materialType)))
      .map((line) => line.lineIndex);
    return lineIndexes.length > 0 ? [{ ...ticket, ticketID: id, lineIndexes }] : [];
  });

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
  // Typed amounts that do not fit: more than a request still wants, or more than the receipt line has.
  const overruns = [];

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
        // What the request asked for, shown on the Allocate screen so the Purchaser knows what each tick is for.
        requestedQuantity: ticket.requestedQuantity ?? null,
        approvedBudgetCents: toCents(ticket.approvedBudget),
        unit: ticket.unit ?? null,
        manualLines: [],
      });
    }
    return portionsByTicket.get(ticket.ticketID);
  }

  // Step 3. Material lines (quantity > 0), in receipt order.
  for (const line of lines) {
    if (line.quantityH === 0) continue;

    // A line the Purchaser matched by hand goes to that request only. If that request is no
    // longer in play (closed, out of scope), the line is matched the normal way.
    const chosen = tickets.find((ticket) => ticket.ticketID === lineTargets[line.lineIndex]);
    // The Purchaser typed how much of this line goes to which request: exactly those requests, in those amounts.
    const manual = quantityTargets[line.lineIndex] || null;
    const matching = manual
      ? tickets.filter((ticket) => manual[ticket.ticketID] !== undefined)
      : chosen ? [chosen] : tickets.filter((ticket) => matches(line.description, ticket.materialType));

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
      const available = leftH.get(ticket.ticketID);
      if (manual) {
        // Typed amounts: take exactly what was typed. More than the request still wants, or more than is
        // left on the receipt line, is reported (and blocks the submit) instead of being quietly cut.
        const entered = manual[ticket.ticketID];
        if (entered === 0) continue;
        const take = Math.min(entered, available, left);
        if (entered > take) {
          overruns.push({
            lineIndex: line.lineIndex,
            ticketID: ticket.ticketID,
            projectName: ticket.projectName,
            materialType: ticket.materialType,
            kind: entered > available ? "request" : "receipt",
            enteredH: entered,
            maxH: entered > available ? available : take,
          });
        }
        if (take === 0) continue;
        pieces.push({ ticket, quantityH: take });
        leftH.set(ticket.ticketID, available - take);
        left -= take;
        continue;
      }
      if (left === 0) break;
      if (available === 0) continue;
      const take = Math.min(left, available);
      pieces.push({ ticket, quantityH: take });
      leftH.set(ticket.ticketID, available - take);
      left -= take;
    }

    // 3d. More than the requests want: that quantity has no request, and nothing is ever allocated
    // without one. It is reported as unmatched (blocks the submit) until a request exists for it.
    // 3e. Price the pieces; the last piece takes the remainder (rule 8). When part of the line has no
    // request, that part is the last piece and takes the remainder instead.
    let pricedCents = 0;
    pieces.forEach((piece, index) => {
      const isLast = left === 0 && index === pieces.length - 1;
      piece.amountCents = isLast
        ? line.amountCents - pricedCents
        : proportionalCents(line.amountCents, piece.quantityH, line.quantityH);
      pricedCents += piece.amountCents;
    });
    if (left > 0) {
      unmatched.push({
        lineIndex: line.lineIndex,
        description: line.description,
        quantityH: left,
        amountCents: line.amountCents - pricedCents,
      });
    }

    for (const piece of pieces) {
      const portion = portionFor(piece.ticket);
      portion.lines.push({
        lineIndex: line.lineIndex,
        description: line.description,
        quantityH: piece.quantityH,
        amountCents: piece.amountCents,
        ...(chosen ? { manual: true } : {}),
      });
      if (chosen && !portion.manualLines.includes(line.description)) portion.manualLines.push(line.description);
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

    // Matched by hand: the fee rides on that request, even if nothing else was bought for it.
    const chosen = tickets.find((ticket) => ticket.ticketID === lineTargets[line.lineIndex]);
    if (chosen) {
      const portion = portionFor(chosen);
      portion.lines.push({ lineIndex: line.lineIndex, description: line.description, quantityH: 0, amountCents: line.amountCents, manual: true });
      portion.manualLines.push(line.description);
      portion.amountCents += line.amountCents;
      continue;
    }

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
    // Integer form of: amount > budget * (1 + allowancePct / 100), so no decimals are involved.
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
      manualLines: portion.manualLines,
      requestedQuantity: portion.requestedQuantity,
      remainingBeforeH: portion.startRemainingH,
      approvedBudgetCents: portion.approvedBudgetCents,
      unit: portion.unit,
    };
  });

  const allocatedCents = portions.reduce((sum, portion) => sum + portion.amountCents, 0);
  const linesCents = lines.reduce((sum, line) => sum + line.amountCents, 0);

  return {
    ok: unmatched.length === 0 && overruns.length === 0 && portions.length >= 1,
    overruns,
    portions,
    extras,
    unmatched,
    allocatedCents,
    linesCents,
    warnings,
    candidates,
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
  for (const over of plan.overruns || []) {
    problems.push(
      over.kind === "request"
        ? `${over.projectName} asked for only ${qty(over.maxH)} of ${over.materialType}, but ${qty(over.enteredH)} was entered.`
        : `${qty(over.enteredH)} of ${over.materialType} for ${over.projectName} is more than is left on the receipt.`
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
  if (portion.manualLines && portion.manualLines.length > 0) {
    parts.push(`Matched by hand to this request: ${portion.manualLines.join(", ")}.`);
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
    ...(line.manual ? { manual: true } : {}),
  });
  return {
    ok: plan.ok,
    problems: describePlanProblems(plan),
    // Typed amounts that did not fit, so the app can mark the field.
    overruns: (plan.overruns || []).map((o) => ({
      lineIndex: o.lineIndex,
      ticketID: o.ticketID,
      kind: o.kind,
      entered: qty(o.enteredH),
      max: qty(o.maxH),
    })),
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
      // What the request wanted and had left before this receipt, and its approved budget.
      requestedQuantity: portion.requestedQuantity,
      remainingBefore: qty(portion.remainingBeforeH),
      approvedBudget: peso(portion.approvedBudgetCents),
      unit: portion.unit,
      lines: portion.lines.map(presentLine),
    })),
    // Always empty now: kept so older clients that read it keep working.
    uncovered: [],
    extras: plan.extras.map((line) => ({ ...presentLine(line), ticketID: line.ticketID })),
    unmatched: plan.unmatched.map(presentLine),
    // Every open request that matches a line, with what it asked for (see planAllocation).
    candidates: (plan.candidates || []).map((ticket) => ({
      ticketID: ticket.ticketID,
      projectID: ticket.projectID,
      projectName: ticket.projectName,
      materialType: ticket.materialType,
      lineIndexes: ticket.lineIndexes,
      requestedQuantity: ticket.requestedQuantity ?? null,
      remainingQuantity: ticket.remainingQuantity === undefined || ticket.remainingQuantity === null ? null : Number(ticket.remainingQuantity),
      unit: ticket.unit ?? null,
      remainingBudget: peso(toCents(ticket.remainingBudget)),
    })),
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
