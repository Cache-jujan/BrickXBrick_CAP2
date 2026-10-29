// tickets.js — F4 ticket creation, acknowledgment, and status transitions.

const express = require("express");
const { query, withTransaction } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { assertLegalTransition, logTransition } = require("../lib/ticketTransitions");
const { notify } = require("../lib/notify");
const { VALID_TICKET_TYPES } = require("../lib/ticketRouting");
const { parseNeededBy } = require("../lib/neededBy");

const router = express.Router();
router.use(requireAuth);

// After a Site Manager creates one or more tickets, tell the managing PM of
// each project. One notification per (project) per request, so a batch of
// several requests to the same project is a single "N new requests" notice
// (decided: one notification per batch). PM-created tickets are born
// Acknowledged and notify the Purchaser via logTransition instead, so they're
// skipped here. Resubmissions are flagged in the message.
async function notifySubmission(client, submitter, tickets) {
    if (submitter.role !== "Site Manager") return;
    // Group this submission's tickets by project.
    const byProject = new Map();
    for (const t of tickets) {
        if (!byProject.has(t.projectid)) byProject.set(t.projectid, []);
        byProject.get(t.projectid).push(t);
    }
    for (const [projectId, group] of byProject) {
        const projRes = await client.query(
            "SELECT name, projectManagerId FROM projects WHERE projectId = $1",
            [projectId]
        );
        if (projRes.rowCount === 0) continue;
        const { name: projectName, projectmanagerid: pmId } = projRes.rows[0];
        const resubmitted = group.filter((t) => t.resubmittedfromid != null).length;
        let message;
        if (group.length === 1) {
            const only = group[0];
            const lead = only.resubmittedfromid != null ? "resubmitted a request" : "sent a request";
            message = `${submitter.name} ${lead}: "${only.subject}" (${projectName}).`;
        } else {
            const extra = resubmitted > 0 ? ` (${resubmitted} resubmitted)` : "";
            message = `${submitter.name} sent ${group.length} requests${extra} (${projectName}).`;
        }
        await notify(client, {
            recipientIds: [pmId],
            excludeUserId: submitter.id,
            type: "TicketSubmitted",
            entityType: "Ticket",
            entityId: group[0].ticketid,
            message,
        });
    }
}

async function getTicket(ticketId) {
    const result = await query(
        `SELECT t.*, p.name AS projectName, p.projectManagerId, p.siteManagerId
           FROM tickets t
           JOIN projects p ON p.projectId = t.projectId
          WHERE t.ticketId = $1`,
        [ticketId]
    );
    if (result.rowCount === 0) {
        const err = new Error(`Ticket ${ticketId} not found`);
        err.status = 404;
        throw err;
    }
    return result.rows[0];
}

// POST / — create a ticket.
//
// Two creators:
//   Site Manager    raises a request on their own assigned project. It starts
//                   Pending; the PM acknowledges it later (assigns a Purchaser,
//                   confirms the budget). Material Requests carry requestedBudget.
//   Project Manager creates directly on a project they manage, to tell the
//                   Purchaser what to buy this phase. Because the PM is the
//                   approver, the ticket is created already Acknowledged: the PM
//                   picks who buys it (assignedTo) now: a Purchaser, or the
//                   project's own Site Manager. For a Material
//                   Request, sets the approvedBudget. PMs create Material Request
//                   or Work Item only (Reports are the SM's channel).
//
// ticketType is a category label only; it does not determine a recipient.
// Build and insert ONE ticket inside the transaction `client`, acting as
// `user`, from a request `body`. Validation reads use the pool; the write
// (insert + status transitions) uses `client` so a batch of these is atomic.
// Throws (err.status) on bad input. Reused by POST / and POST /batch.
async function createTicketRecord(client, user, body) {
        const {
            projectID,
            ticketType,
            subject,
            description,
            photoURL,
            materialType,
            quantity,
            unit,
            vendorName,
            requestedBudget,
            approvedBudget,
            assignedTo,
            bomItemID,
            notInBom,
            notInBomReason,
            resubmittedFromId,
            neededBy,
        } = body;

        const isPM = user.role === "Project Manager";
        const isSM = user.role === "Site Manager";

        if (!projectID || !ticketType || !subject) {
            const err = new Error("projectID, ticketType, and subject are required");
            err.status = 400;
            throw err;
        }

        if (!VALID_TICKET_TYPES.includes(ticketType)) {
            const err = new Error(`ticketType must be one of: ${VALID_TICKET_TYPES.join(", ")}`);
            err.status = 400;
            throw err;
        }

        const isMaterialReq = ticketType === "Material Request";
        const isWorkItem = ticketType === "Work Item";

        // Reports are the Site Manager's issue-report channel — the PM resolves
        // them, not creates them.
        if (isPM && ticketType === "Report") {
            const err = new Error("Project Managers create Material Request or Work Item tickets; Reports are raised by the Site Manager");
            err.status = 400;
            throw err;
        }

        // Shared procurement context for Material Request / Work Item.
        // Vendor is optional: a Site Manager may not know where to buy, so the
        // Project Manager can fill it in when acknowledging the ticket.
        if (isMaterialReq || isWorkItem) {
            if (quantity === undefined || quantity === null) {
                const err = new Error("Material Request and Work Item tickets require a quantity");
                err.status = 400;
                throw err;
            }
            if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
                const err = new Error("quantity must be a positive number");
                err.status = 400;
                throw err;
            }
        }

        // Optional date the material is needed by. Reports have no due date.
        const neededByValue = isMaterialReq || isWorkItem ? parseNeededBy(neededBy) : null;

        // Work Item keeps a free-text materialType (no BOM link).
        if (isWorkItem && !materialType) {
            const err = new Error("Work Item tickets require materialType");
            err.status = 400;
            throw err;
        }

        // Unit of measure. A Work Item and a Not-in-BOM Material Request need an
        // explicit unit from the creator; an on-BOM Material Request derives it
        // from the BOM item below, so it's not required in the request body.
        const unitText = typeof unit === "string" ? unit.trim() : "";
        if (isWorkItem && !unitText) {
            const err = new Error("Work Item tickets require a unit (e.g. pcs, kg, m)");
            err.status = 400;
            throw err;
        }

        // Budgets differ by creator:
        //   SM Material Request -> requestedBudget (the PM confirms it later)
        //   PM Material Request -> approvedBudget  (the PM is approving now)
        if (isSM && isMaterialReq && (typeof requestedBudget !== "number" || !Number.isFinite(requestedBudget) || requestedBudget < 0)) {
            const err = new Error("Material Request tickets require a non-negative requestedBudget in PHP");
            err.status = 400;
            throw err;
        }
        if (isPM && isMaterialReq && (typeof approvedBudget !== "number" || !Number.isFinite(approvedBudget) || approvedBudget < 0)) {
            const err = new Error("A Project Manager's Material Request requires a non-negative approvedBudget in PHP");
            err.status = 400;
            throw err;
        }

        // A PM-created ticket is born Acknowledged, so it needs its buyer now.
        if (isPM && (isMaterialReq || isWorkItem) && !assignedTo) {
            const err = new Error("assignedTo (a Purchaser's userId, or this project's Site Manager) is required when a Project Manager creates a ticket");
            err.status = 400;
            throw err;
        }

        const projectResult = await query(
            "SELECT projectId, status, siteManagerId, projectManagerId FROM projects WHERE projectId = $1",
            [projectID]
        );
        if (projectResult.rowCount === 0) {
            const err = new Error(`Project ${projectID} not found`);
            err.status = 404;
            throw err;
        }
        const project = projectResult.rows[0];

        if (isSM && project.sitemanagerid !== user.id) {
            const err = new Error("You may only create tickets on the project you are assigned to");
            err.status = 403;
            throw err;
        }
        if (isPM && project.projectmanagerid !== user.id) {
            const err = new Error("You may only create tickets on a project you manage");
            err.status = 403;
            throw err;
        }

        // Tickets (and the purchases behind them) start only once the project
        // is Active — Draft is the planning stage before the BOM is approved.
        if (project.status !== "Active") {
            const err = new Error(`Tickets can only be created on an Active project; this project is ${project.status}`);
            err.status = 409;
            throw err;
        }

        // Validate who the PM is assigning to buy. Normally a Purchaser (same rules as
        // /acknowledge). The PM may also hand a Material Request straight to the project's
        // own Site Manager, instead of waiting for the Site Manager to request it.
        if (isPM) {
            const assigneeResult = await query(
                "SELECT userId, role, status FROM users WHERE userId = $1",
                [assignedTo]
            );
            if (assigneeResult.rowCount === 0) {
                const err = new Error(`Assigned user ${assignedTo} not found`);
                err.status = 404;
                throw err;
            }
            const assignee = assigneeResult.rows[0];
            if (assignee.status !== "Active") {
                const err = new Error(`Assigned user ${assignedTo} is not an active account`);
                err.status = 400;
                throw err;
            }
            if (assignee.role === "Site Manager") {
                // Only the Site Manager on this project can see and buy its requests. They buy
                // the same ticket types a Purchaser does (Material Request and Work Item).
                if (assignee.userid !== project.sitemanagerid) {
                    const err = new Error("A Site Manager can only be assigned a purchase on the project they are assigned to");
                    err.status = 400;
                    throw err;
                }
            } else if (assignee.role !== "Purchaser") {
                const err = new Error(`assignedTo must be a Purchaser or this project's Site Manager, but user ${assignedTo} is a ${assignee.role}`);
                err.status = 400;
                throw err;
            }
        }

        // Resolve the BOM link for Material Requests (either creator). Active
        // implies the project already has an Approved BOM to pick from;
        // genuinely-absent materials take the Not-in-BOM path.
        let resolvedMaterialType = materialType || null;
        let resolvedBomItemID = null;
        let resolvedNotInBom = false;
        let resolvedNotInBomReason = null;
        // On-BOM: derived from the BOM item. Not-in-BOM / Work Item: from the
        // creator's pick. Report / anything else: null.
        let resolvedUnit = isWorkItem ? unitText : null;

        if (isMaterialReq) {
            const hasBomItem = typeof bomItemID === "string" && bomItemID.trim() !== "";
            const markedNotInBom = notInBom === true;

            if (hasBomItem && markedNotInBom) {
                const err = new Error("A Material Request is either from the BOM or marked Not in BOM, not both");
                err.status = 400;
                throw err;
            }
            if (!hasBomItem && !markedNotInBom) {
                const err = new Error("Pick a BOM item, or mark the request as Not in BOM with a reason");
                err.status = 400;
                throw err;
            }

            if (hasBomItem) {
                // The item must belong to THIS project's approved BOM.
                const itemResult = await query(
                    `SELECT i.bomitemid, i.description, i.unit
                       FROM bomitems i
                       JOIN bomsections s ON s.sectionid = i.sectionid
                       JOIN boms b ON b.bomid = s.bomid
                      WHERE i.bomitemid = $1 AND b.projectid = $2 AND b.status = 'Approved'`,
                    [bomItemID, projectID]
                );
                if (itemResult.rowCount === 0) {
                    const err = new Error("That BOM item isn't part of this project's approved Bill of Materials");
                    err.status = 400;
                    throw err;
                }
                resolvedBomItemID = bomItemID;
                resolvedMaterialType = itemResult.rows[0].description; // stay consistent with the BOM
                resolvedUnit = itemResult.rows[0].unit; // unit comes from the BOM too
            } else {
                if (typeof notInBomReason !== "string" || notInBomReason.trim() === "") {
                    const err = new Error("A reason is required when the material isn't in the BOM");
                    err.status = 400;
                    throw err;
                }
                if (!materialType) {
                    const err = new Error("Material Request tickets require materialType when the item isn't in the BOM");
                    err.status = 400;
                    throw err;
                }
                if (!unitText) {
                    const err = new Error("Material Request tickets require a unit when the item isn't in the BOM");
                    err.status = 400;
                    throw err;
                }
                resolvedNotInBom = true;
                resolvedNotInBomReason = notInBomReason.trim();
                resolvedMaterialType = materialType;
                resolvedUnit = unitText;
            }
        }

        // Fix & resubmit (Site Manager only): this new ticket replaces a
        // ticket of theirs that the PM rejected. The original must be their
        // own, currently Rejected, and not already resubmitted (a partial
        // unique index also enforces the last rule at the DB level).
        let resolvedResubmittedFromId = null;
        if (resubmittedFromId !== undefined && resubmittedFromId !== null && resubmittedFromId !== "") {
            if (!isSM) {
                const err = new Error("Only a Site Manager can resubmit a rejected request");
                err.status = 403;
                throw err;
            }
            const origResult = await query(
                "SELECT ticketId, submittedBy, status, projectId FROM tickets WHERE ticketId = $1",
                [resubmittedFromId]
            );
            if (origResult.rowCount === 0) {
                const err = new Error("The request you're resubmitting no longer exists");
                err.status = 404;
                throw err;
            }
            const orig = origResult.rows[0];
            if (orig.submittedby !== user.id) {
                const err = new Error("You can only resubmit your own request");
                err.status = 403;
                throw err;
            }
            if (orig.status !== "Rejected") {
                const err = new Error("Only a rejected request can be resubmitted");
                err.status = 409;
                throw err;
            }
            const dupe = await query(
                "SELECT 1 FROM tickets WHERE resubmittedFromId = $1",
                [resubmittedFromId]
            );
            if (dupe.rowCount > 0) {
                const err = new Error("This request was already resubmitted");
                err.status = 409;
                throw err;
            }
            resolvedResubmittedFromId = resubmittedFromId;
        }

        // Creator-dependent columns.
        const status = isPM ? "Acknowledged" : "Pending";
        const requestedBudgetValue = isSM && isMaterialReq ? requestedBudget : null;
        const approvedBudgetValue = isPM && isMaterialReq ? approvedBudget : null;
        const assignedToValue = isPM ? assignedTo : null;
        const acknowledgedByValue = isPM ? user.id : null;
        const acknowledgedAtSql = isPM ? "NOW()" : "NULL"; // derived from role, not user input

        {
            const insertResult = await client.query(
                `INSERT INTO tickets
                   (projectId, submittedBy, ticketType, subject, description, photoURL,
                    materialType, quantity, unit, vendorName, requestedBudget,
                    bomItemID, notInBom, notInBomReason,
                    status, assignedTo, acknowledgedBy, approvedBudget, resubmittedFromId, neededBy, acknowledgedAt)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, ${acknowledgedAtSql})
                 RETURNING *`,
                [
                    projectID,
                    user.id,
                    ticketType,
                    subject,
                    description || null,
                    photoURL || null,
                    resolvedMaterialType,
                    quantity ?? null,
                    resolvedUnit,
                    vendorName || null,
                    requestedBudgetValue,
                    resolvedBomItemID,
                    resolvedNotInBom,
                    resolvedNotInBomReason,
                    status,
                    assignedToValue,
                    acknowledgedByValue,
                    approvedBudgetValue,
                    resolvedResubmittedFromId,
                    neededByValue,
                ]
            );
            const newTicket = insertResult.rows[0];

            // Audit: every ticket is born Pending. A PM-created ticket is
            // acknowledged by the same action, so record that transition too.
            await logTransition(client, {
                ticketId: newTicket.ticketid,
                fromStatus: null,
                toStatus: "Pending",
                changedBy: user.id,
            });
            if (isPM) {
                await logTransition(client, {
                    ticketId: newTicket.ticketid,
                    fromStatus: "Pending",
                    toStatus: "Acknowledged",
                    changedBy: user.id,
                });
            }

            return newTicket;
        }
}

// POST / — create a single ticket (SM request, or PM direct create).
router.post("/", requireRole("Site Manager", "Project Manager"), async (req, res, next) => {
    try {
        const ticket = await withTransaction(async (client) => {
            const created = await createTicketRecord(client, req.user, req.body);
            await notifySubmission(client, req.user, [created]);
            return created;
        });
        res.status(201).json(ticket);
    } catch (err) {
        next(err);
    }
});

// POST /batch — create several tickets atomically (all succeed or none).
// Used by the Site Manager's mobile multi-card form. Mixed ticket types are
// allowed; each item is validated exactly like a single create.
router.post("/batch", requireRole("Site Manager", "Project Manager"), async (req, res, next) => {
    try {
        const items = Array.isArray(req.body && req.body.tickets) ? req.body.tickets : null;
        if (!items || items.length === 0) {
            const err = new Error("tickets must be a non-empty array");
            err.status = 400;
            throw err;
        }
        if (items.length > 20) {
            const err = new Error("A batch can contain at most 20 tickets");
            err.status = 400;
            throw err;
        }
        const created = await withTransaction(async (client) => {
            const out = [];
            for (const item of items) {
                out.push(await createTicketRecord(client, req.user, item));
            }
            // One batch → one "N new requests" notice per project (not N).
            await notifySubmission(client, req.user, out);
            return out;
        });
        res.status(201).json({ tickets: created });
    } catch (err) {
        next(err);
    }
});

// GET /vendors — approved vendors available for procurement tickets (SM or PM).
router.get("/vendors", requireRole("Site Manager", "Project Manager"), async (req, res, next) => {
    try {
        const result = await query(
            `SELECT vendorID AS "vendorID", vendorName AS "vendorName"
               FROM VendorMasterList
              WHERE approvalStatus = 'Approved'
              ORDER BY vendorName ASC`
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /assigned — tickets currently routed to the calling Purchaser.
// Pending tickets are naturally excluded: assignedTo is NULL until a PM
// acknowledges and assigns a Purchaser.
// expenseCount/expenseTotal: same non-blocking double-capture tightening as
// /submitted (see comment there) — Purchasers can also add more than one
// expense to a ticket, this just surfaces that one is already captured.
router.get("/assigned", requireRole("Purchaser"), async (req, res, next) => {
    try {
        const result = await query(
            `SELECT t.*,
                    p.name AS projectName,
                    COALESCE(ec.expenseCount, 0) AS expenseCount,
                    COALESCE(ec.expenseTotal, 0) AS expenseTotal
               FROM tickets t
               JOIN projects p ON p.projectId = t.projectId
               LEFT JOIN LATERAL (
                   SELECT COUNT(*) AS expenseCount, SUM(amount) AS expenseTotal
                     FROM expenses e
                    WHERE e.ticketId = t.ticketId AND e.status <> 'Rejected'
               ) ec ON TRUE
              WHERE t.assignedTo = $1
              ORDER BY t.createdAt DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /expense-linkable — resolved procurement tickets for GM/PM expense entry.
// PM results are restricted in SQL to projects managed by the calling PM.
router.get("/expense-linkable", requireRole("General Manager", "Project Manager"), async (req, res, next) => {
    try {
        const params = [];
        let projectScope = "";
        if (req.user.role === "Project Manager") {
            params.push(req.user.id);
            projectScope = "AND p.projectManagerId = $1";
        }

        const result = await query(
            `SELECT t.ticketId AS "ticketID",
                    t.projectId AS "projectID",
                    p.name AS "projectName",
                    t.subject,
                    t.vendorName AS "vendorName",
                    t.materialType AS "materialType",
                    t.quantity,
                    t.resolvedAt AS "resolvedAt"
               FROM tickets t
               JOIN projects p ON p.projectId = t.projectId
              WHERE t.status = 'Resolved'
                AND t.ticketType = 'Material Request'
                -- not yet fulfilled: same rule as lib/ticketAvailability.js
                AND (
                  (t.quantity IS NULL AND NOT EXISTS (
                    SELECT 1 FROM expenses e WHERE e.ticketId = t.ticketId AND e.status <> 'Rejected'))
                  OR (t.quantity IS NOT NULL AND t.quantity > COALESCE((
                    SELECT SUM(e.quantity) FROM expenses e WHERE e.ticketId = t.ticketId AND e.status <> 'Rejected'), 0))
                )
                ${projectScope}
              ORDER BY t.resolvedAt DESC NULLS LAST, t.createdAt DESC`,
            params
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /pending — pending tickets for projects owned by the calling PM.
// The project scope is enforced in SQL so a PM cannot see another PM's queue.
router.get("/pending", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const result = await query(
            `SELECT t.*, p.name AS projectName, u.name AS submittedByName
               FROM tickets t
               JOIN projects p ON p.projectId = t.projectId
               LEFT JOIN users u ON u.userId = t.submittedBy
              WHERE p.projectManagerId = $1 AND t.status = 'Pending'
              ORDER BY t.createdAt ASC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /managed — all tickets on the calling PM's projects, filtered by a
// status group, with the context the PM needs to act:
//   ?status=Pending       -> "Needs action" queue (same rows as /pending)
//   ?status=Acknowledged  -> "With purchaser"
//   ?status=History       -> Resolved + Rejected (newest first)
//   &projectId=<id>       -> narrow to one of the PM's projects (optional)
//
// For on-BOM Material Requests it also returns BOM context so the PM can judge
// the budget: the BOM unit cost, BOM quantity, and how much of that BOM item
// has already been requested on OTHER non-rejected tickets (so "this request"
// can be compared against what's left). Scope is enforced in SQL.
router.get("/managed", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const group = req.query.status || "Pending";
        let statusClause;
        if (group === "Pending") statusClause = "t.status = 'Pending'";
        else if (group === "Acknowledged") statusClause = "t.status = 'Acknowledged'";
        else if (group === "History") statusClause = "t.status IN ('Resolved', 'Rejected')";
        else {
            const err = new Error("status must be Pending, Acknowledged, or History");
            err.status = 400;
            throw err;
        }

        const params = [req.user.id];
        let projectClause = "";
        if (req.query.projectId) {
            params.push(req.query.projectId);
            projectClause = `AND t.projectId = $${params.length}`;
        }

        // Order: the queue reads oldest-first (act on what's waited longest);
        // history reads newest-first.
        const order = group === "History"
            ? "ORDER BY COALESCE(t.resolvedAt, t.updatedAt) DESC, t.createdAt DESC"
            : "ORDER BY t.createdAt ASC";

        const result = await query(
            `SELECT t.*,
                    p.name AS projectName,
                    u.name AS submittedByName,
                    r.name AS resolvedByName,
                    a.name AS assignedToName,
                    orig.subject         AS "resubmitOfSubject",
                    orig.rejectionReason AS "resubmitOfReason",
                    EXISTS (SELECT 1 FROM tickets n WHERE n.resubmittedFromId = t.ticketId) AS "wasResubmitted",
                    bi.quantity AS "bomQuantity",
                    bi.unitCost AS "bomUnitCost",
                    bi.unit     AS "bomUnit",
                    COALESCE(agg.alreadyRequested, 0) AS "bomAlreadyRequested"
               FROM tickets t
               JOIN projects p ON p.projectId = t.projectId
               LEFT JOIN users u ON u.userId = t.submittedBy
               LEFT JOIN users r ON r.userId = t.resolvedBy
               LEFT JOIN users a ON a.userId = t.assignedTo
               LEFT JOIN tickets orig ON orig.ticketId = t.resubmittedFromId
               LEFT JOIN bomItems bi ON bi.bomItemId = t.bomItemId
               LEFT JOIN LATERAL (
                   SELECT SUM(o.quantity) AS alreadyRequested
                     FROM tickets o
                    WHERE o.bomItemId = t.bomItemId
                      AND o.bomItemId IS NOT NULL
                      AND o.ticketId <> t.ticketId
                      AND o.status <> 'Rejected'
               ) agg ON TRUE
              WHERE p.projectManagerId = $1
                AND ${statusClause}
                ${projectClause}
              ${order}`,
            params
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /purchasers — who a PM can assign a purchase to: the active Purchasers.
// With ?projectID=<id> for a project this PM manages, that project's active Site
// Manager is added to the end of the list (role "Site Manager"), because the PM can
// hand a purchase straight to them instead of waiting for their request.
router.get("/purchasers", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const result = await query(
            `SELECT userId, name, email, role
               FROM users
              WHERE role = 'Purchaser' AND status = 'Active'
              ORDER BY name ASC`
        );
        const people = result.rows;
        const { projectID } = req.query;
        if (projectID) {
            const siteManager = await query(
                `SELECT u.userId, u.name, u.email, u.role
                   FROM projects p
                   JOIN users u ON u.userId = p.siteManagerId
                  WHERE p.projectId = $1
                    AND p.projectManagerId = $2
                    AND u.role = 'Site Manager'
                    AND u.status = 'Active'`,
                [projectID, req.user.id]
            );
            people.push(...siteManager.rows);
        }
        res.json(people);
    } catch (err) {
        next(err);
    }
});

// GET /submitted — tickets created by the calling user (Site Manager view).
// No role gate: the WHERE filter already scopes results to the caller's own
// tickets, so a PM/Purchaser hitting this just gets an empty list.
//
// Also returns, per ticket: resubmittedById (the newer ticket that
// resubmitted this one, if any — lets My Requests show "Resubmitted ✓"
// instead of a "Fix & resubmit" button) and expenseCount/expenseTotal
// (non-rejected expenses already captured against it — a ticket CAN
// legitimately have more than one, so this is display-only: it flips the
// card's action from "+ Add Expense" to "+ Add another expense", never a
// backend block).
router.get("/submitted", async (req, res, next) => {
    try {
        const result = await query(
            `SELECT t.*, u.role AS rejectedByRole, n.ticketId AS resubmittedById,
                    COALESCE(ec.expenseCount, 0) AS expenseCount,
                    COALESCE(ec.expenseTotal, 0) AS expenseTotal
               FROM tickets t
               LEFT JOIN users u ON u.userId = t.resolvedBy
               LEFT JOIN tickets n ON n.resubmittedFromId = t.ticketId
               LEFT JOIN LATERAL (
                   SELECT COUNT(*) AS expenseCount, SUM(amount) AS expenseTotal
                     FROM expenses e
                    WHERE e.ticketId = t.ticketId AND e.status <> 'Rejected'
               ) ec ON TRUE
              WHERE t.submittedBy = $1
              ORDER BY t.createdAt DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// PATCH /:id/acknowledge — PM only, Pending -> Acknowledged.
// This is the point at which a specific Purchaser is assigned to the ticket.
router.patch("/:id/acknowledge", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const ticket = await getTicket(req.params.id);

        if (ticket.projectmanagerid !== req.user.id) {
            const err = new Error("You may only acknowledge tickets from projects assigned to you");
            err.status = 403;
            throw err;
        }

        if (ticket.tickettype === "Report") {
            const err = new Error("Report tickets are resolved directly by the PM, not acknowledged — use /resolve instead");
            err.status = 400;
            throw err;
        }

        const { assignedTo, approvedBudget } = req.body;

        if (!assignedTo) {
            const err = new Error("assignedTo (a Purchaser's userId) is required to acknowledge a ticket");
            err.status = 400;
            throw err;
        }

        let approvedBudgetValue = null;
        if (ticket.tickettype === "Material Request") {
            if (typeof approvedBudget !== "number" || !Number.isFinite(approvedBudget) || approvedBudget < 0) {
                const err = new Error("A non-negative approvedBudget in PHP is required for a Material Request");
                err.status = 400;
                throw err;
            }
            approvedBudgetValue = approvedBudget;
        }

        const assigneeResult = await query(
            "SELECT userId, role, status FROM users WHERE userId = $1",
            [assignedTo]
        );
        if (assigneeResult.rowCount === 0) {
            const err = new Error(`Assigned user ${assignedTo} not found`);
            err.status = 404;
            throw err;
        }
        const assignee = assigneeResult.rows[0];
        if (assignee.status !== "Active") {
            const err = new Error(`Assigned user ${assignedTo} is not an active account`);
            err.status = 400;
            throw err;
        }
        if (assignee.role !== "Purchaser") {
            const err = new Error(`assignedTo must be a Purchaser, but user ${assignedTo} is a ${assignee.role}`);
            err.status = 400;
            throw err;
        }

        // The PM may set or change the needed-by date while acknowledging.
        // Sending the key (even null to clear it) replaces the Site Manager's
        // date; leaving it out keeps whatever the ticket already has.
        const changesNeededBy = Object.prototype.hasOwnProperty.call(req.body, "neededBy")
            && ticket.tickettype !== "Report";
        const neededByValue = changesNeededBy ? parseNeededBy(req.body.neededBy) : null;

        assertLegalTransition(ticket.status, "Acknowledged");

        const updated = await withTransaction(async (client) => {
            const updateResult = await client.query(
                `UPDATE tickets
                    SET status = 'Acknowledged', assignedTo = $1, acknowledgedBy = $2,
                        acknowledgedAt = NOW(), approvedBudget = $3,
                        neededBy = CASE WHEN $6::boolean THEN $7::date ELSE neededBy END,
                        updatedAt = NOW()
                  WHERE ticketId = $4 AND status = $5
                  RETURNING *`,
                [assignedTo, req.user.id, approvedBudgetValue, req.params.id, ticket.status, changesNeededBy, neededByValue]
            );

            if (updateResult.rowCount === 0) {
                const err = new Error("Ticket status changed before this request was completed");
                err.status = 409;
                throw err;
            }

            await logTransition(client, {
                ticketId: req.params.id,
                fromStatus: ticket.status,
                toStatus: "Acknowledged",
                changedBy: req.user.id,
            });

            return updateResult.rows[0];
        });

        res.json(updated);
    } catch (err) {
        next(err);
    }
});

// PATCH /:id/resolve — Material Request/Work Item: the assigned buyer only (a
// Purchaser, or the project's Site Manager when the PM assigned them),
// Acknowledged -> Resolved. Report: Project Manager only, Pending ->
// Resolved directly — Report never goes through /acknowledge, so this is
// intentionally NOT run through assertLegalTransition (that table only
// knows Acknowledged -> Resolved; Pending -> Resolved is a Report-only
// exception, not a general state-machine rule).
router.patch("/:id/resolve", requireRole("Purchaser", "Project Manager", "Site Manager"), async (req, res, next) => {
    try {
        const ticket = await getTicket(req.params.id);

        if (ticket.tickettype === "Report") {
            if (req.user.role !== "Project Manager") {
                const err = new Error("Only the Project Manager can resolve a Report ticket");
                err.status = 403;
                throw err;
            }
            if (ticket.status !== "Pending") {
                const err = new Error("Report tickets can only be resolved while Pending");
                err.status = 409;
                throw err;
            }
        } else {
            // The buyer: the assigned Purchaser, or the project's Site Manager when the PM assigned them.
            if (req.user.role !== "Purchaser" && req.user.role !== "Site Manager") {
                const err = new Error("Only the assigned Purchaser or Site Manager can resolve this ticket");
                err.status = 403;
                throw err;
            }
            if (ticket.assignedto !== req.user.id) {
                const err = new Error("Only the assigned Purchaser or Site Manager can resolve this ticket");
                err.status = 403;
                throw err;
            }
            if (req.user.role === "Site Manager" && ticket.sitemanagerid !== req.user.id) {
                const err = new Error("You are no longer the Site Manager of this project");
                err.status = 403;
                throw err;
            }
            assertLegalTransition(ticket.status, "Resolved");
        }

        const updated = await withTransaction(async (client) => {
            const updateResult = await client.query(
                `UPDATE tickets
                    SET status = 'Resolved', resolvedBy = $1, resolvedAt = NOW(), updatedAt = NOW()
                  WHERE ticketId = $2 AND status = $3
                  RETURNING *`,
                [req.user.id, req.params.id, ticket.status]
            );

            if (updateResult.rowCount === 0) {
                const err = new Error("Ticket status changed before this request was completed");
                err.status = 409;
                throw err;
            }

            await logTransition(client, {
                ticketId: req.params.id,
                fromStatus: ticket.status,
                toStatus: "Resolved",
                changedBy: req.user.id,
            });

            return updateResult.rows[0];
        });

        res.json(updated);
    } catch (err) {
        next(err);
    }
});

// PATCH /:id/reject — PM (Pending only) or assigned Purchaser (Acknowledged only).
router.patch("/:id/reject", requireRole("Project Manager", "Purchaser", "Site Manager"), async (req, res, next) => {
    try {
        const ticket = await getTicket(req.params.id);

        const reasonText = typeof req.body.reason === "string" ? req.body.reason.trim() : "";

        if (req.user.role === "Project Manager") {
            if (ticket.status !== "Pending") {
                const err = new Error("Project Manager may only reject a ticket while it is Pending");
                err.status = 409;
                throw err;
            }
            // The PM must say why, so the Site Manager knows what to fix.
            if (!reasonText) {
                const err = new Error("A reason is required to reject a ticket");
                err.status = 400;
                throw err;
            }
        } else {
            // The buyer: the assigned Purchaser, or the project's Site Manager when the PM assigned them.
            if (ticket.assignedto !== req.user.id) {
                const err = new Error("Only the assigned Purchaser or Site Manager can reject this ticket");
                err.status = 403;
                throw err;
            }
            if (req.user.role === "Site Manager" && ticket.sitemanagerid !== req.user.id) {
                const err = new Error("You are no longer the Site Manager of this project");
                err.status = 403;
                throw err;
            }
            if (ticket.status !== "Acknowledged") {
                const err = new Error("The buyer may only reject a ticket while it is Acknowledged");
                err.status = 409;
                throw err;
            }
        }

        assertLegalTransition(ticket.status, "Rejected");

        const updated = await withTransaction(async (client) => {
            const updateResult = await client.query(
                `UPDATE tickets
                    SET status = 'Rejected', resolvedBy = $1, resolvedAt = NOW(), updatedAt = NOW(),
                        rejectionReason = $4
                  WHERE ticketId = $2 AND status = $3
                  RETURNING *`,
                [req.user.id, req.params.id, ticket.status, reasonText || null]
            );

            if (updateResult.rowCount === 0) {
                const err = new Error("Ticket status changed before this request was completed");
                err.status = 409;
                throw err;
            }

            await logTransition(client, {
                ticketId: req.params.id,
                fromStatus: ticket.status,
                toStatus: "Rejected",
                changedBy: req.user.id,
            });

            return updateResult.rows[0];
        });

        res.json(updated);
    } catch (err) {
        next(err);
    }
});

// PATCH /:id — the Project Manager edits a Site Manager's pending ticket
// before acting on it (fix a quantity, add the vendor the SM didn't know, etc).
// Declared after the specific /:id/* routes so it only matches a bare id.
//
// Scope: PM-only, on a project they manage, and only while the ticket is still
// Pending. Editable fields depend on the ticket's shape; the BOM linkage itself
// (which BOM item, or on-BOM vs not-in-BOM) is NOT editable here — an on-BOM
// Material Request keeps its BOM-derived materialType and unit locked.
router.patch("/:id", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const ticket = await getTicket(req.params.id);

        if (ticket.projectmanagerid !== req.user.id) {
            const err = new Error("You may only edit tickets from projects you manage");
            err.status = 403;
            throw err;
        }
        if (ticket.status !== "Pending") {
            const err = new Error(`Only pending tickets can be edited; this one is ${ticket.status}`);
            err.status = 409;
            throw err;
        }

        const isReport = ticket.tickettype === "Report";
        const isMaterialReq = ticket.tickettype === "Material Request";
        const isWorkItem = ticket.tickettype === "Work Item";
        const onBom = ticket.bomitemid != null; // on-BOM MR → material/unit locked

        const { subject, description, quantity, unit, materialType, vendorName, requestedBudget, notInBomReason } = req.body;

        if (typeof subject !== "string" || !subject.trim()) {
            const err = new Error("subject is required");
            err.status = 400;
            throw err;
        }

        let p = 0;
        const sets = [];
        const vals = [];
        const set = (col, val) => { p += 1; sets.push(`${col} = $${p}`); vals.push(val); };

        set("subject", subject.trim().slice(0, 100));
        set("description", typeof description === "string" && description.trim() ? description.trim() : null);

        if (isMaterialReq || isWorkItem) {
            const q = Number(quantity);
            if (!Number.isFinite(q) || q <= 0) {
                const err = new Error("quantity must be a positive number");
                err.status = 400;
                throw err;
            }
            set("quantity", q);
            // Vendor is optional (nullable) — the SM may not know it.
            set("vendorName", typeof vendorName === "string" && vendorName.trim() ? vendorName.trim() : null);
        }

        if (isMaterialReq) {
            const b = Number(requestedBudget);
            if (!Number.isFinite(b) || b < 0) {
                const err = new Error("requestedBudget must be 0 or more");
                err.status = 400;
                throw err;
            }
            set("requestedBudget", b);
        }

        // Material + unit are creator-supplied only when not on the BOM.
        if ((isMaterialReq && !onBom) || isWorkItem) {
            if (typeof materialType !== "string" || !materialType.trim()) {
                const err = new Error("materialType is required");
                err.status = 400;
                throw err;
            }
            if (typeof unit !== "string" || !unit.trim()) {
                const err = new Error("unit is required");
                err.status = 400;
                throw err;
            }
            set("materialType", materialType.trim());
            set("unit", unit.trim().slice(0, 30));
        }

        if (isMaterialReq && !onBom) {
            if (typeof notInBomReason !== "string" || !notInBomReason.trim()) {
                const err = new Error("a reason is required for a not-in-BOM Material Request");
                err.status = 400;
                throw err;
            }
            set("notInBomReason", notInBomReason.trim());
        }

        // isReport falls through with just subject + description updated.
        const result = await query(
            `UPDATE tickets SET ${sets.join(", ")}, updatedAt = NOW()
              WHERE ticketId = $${p + 1} AND status = 'Pending'
              RETURNING *`,
            [...vals, req.params.id]
        );
        if (result.rowCount === 0) {
            const err = new Error("This ticket is no longer pending");
            err.status = 409;
            throw err;
        }
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

module.exports = router;