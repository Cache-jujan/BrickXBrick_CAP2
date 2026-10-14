// notify.js — small helper for writing notifications.
//
// Always called with the transaction `client` of the change that triggered
// the notification, so the notification commits or rolls back together with
// that change. Never notifies the actor themselves.

// Insert one notification per distinct recipient. Silently skips null/blank
// recipient ids and (optionally) the actor. Safe to call with an empty list.
async function notify(client, { recipientIds, excludeUserId, type, entityType, entityId, message }) {
  const seen = new Set();
  for (const raw of recipientIds || []) {
    const id = raw && String(raw);
    if (!id) continue;
    if (excludeUserId && id === String(excludeUserId)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO notifications (recipientId, type, relatedEntityType, relatedEntityId, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, type, entityType, entityId, message]
    );
  }
}

// Notifications for a ticket STATUS change. Called from logTransition so that
// every code path that moves a ticket (PM acknowledge/reject/resolve, Purchaser
// resolve/reject, F8 allocation resolve) produces the right notifications with
// no per-route wiring. Only Acknowledged / Resolved / Rejected are announced;
// the initial Pending (and a PM-created ticket's immediate Acknowledged) are
// handled by the create path, which knows about batching.
//
// Uses only guaranteed-present columns so it can never throw and roll back the
// ticket change it rides along with.
const TYPE_BY_STATUS = {
  Acknowledged: "TicketAcknowledged",
  Resolved: "TicketResolved",
  Rejected: "TicketRejected",
};

async function notifyTicketTransition(client, { ticketId, toStatus, changedBy }) {
  const type = TYPE_BY_STATUS[toStatus];
  if (!type) return; // Pending (birth) and anything else: no transition notice.

  const { rows } = await client.query(
    `SELECT t.ticketId, t.subject, t.ticketType, t.status, t.submittedBy,
            t.assignedTo, t.rejectionReason, p.name AS projectName, p.projectManagerId
       FROM tickets t
       JOIN projects p ON p.projectId = t.projectId
      WHERE t.ticketId = $1`,
    [ticketId]
  );
  if (rows.length === 0) return;
  const t = rows[0];
  const subject = t.subject || "your request";
  const project = t.projectname || "a project";

  if (toStatus === "Acknowledged") {
    // SM who raised it: approved. Purchaser now assigned: something to buy.
    await notify(client, {
      recipientIds: [t.submittedby],
      excludeUserId: changedBy,
      type,
      entityType: "Ticket",
      entityId: ticketId,
      message: `Your request "${subject}" was approved and sent to a purchaser (${project}).`,
    });
    await notify(client, {
      recipientIds: [t.assignedto],
      excludeUserId: changedBy,
      type,
      entityType: "Ticket",
      entityId: ticketId,
      message: `New purchase to handle: "${subject}" (${project}).`,
    });
    return;
  }

  if (toStatus === "Resolved") {
    const message =
      t.tickettype === "Report"
        ? `Your report "${subject}" was resolved (${project}).`
        : `"${subject}" is resolved and ready for expense capture (${project}).`;
    await notify(client, {
      recipientIds: [t.submittedby],
      excludeUserId: changedBy,
      type,
      entityType: "Ticket",
      entityId: ticketId,
      message,
    });
    return;
  }

  if (toStatus === "Rejected") {
    const reason = t.rejectionreason ? ` Reason: ${t.rejectionreason}` : "";
    // The submitter always hears, in their own voice.
    await notify(client, {
      recipientIds: [t.submittedby],
      excludeUserId: changedBy,
      type,
      entityType: "Ticket",
      entityId: ticketId,
      message: `Your request "${subject}" was rejected (${project}).${reason}`,
    });
    // If a Purchaser rejected it, the PM hears too — as a manager notice.
    // (When the PM is the one rejecting, excludeUserId drops them here.)
    await notify(client, {
      recipientIds: [t.projectmanagerid],
      excludeUserId: changedBy,
      type,
      entityType: "Ticket",
      entityId: ticketId,
      message: `A request on ${project} — "${subject}" — was rejected by the purchaser.${reason}`,
    });
  }
}

module.exports = { notify, notifyTicketTransition };