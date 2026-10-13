// tickets.js — F4 ticket creation, acknowledgment, and status transitions.

const express = require("express");
const { query, withTransaction } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { assertLegalTransition, logTransition } = require("../lib/ticketTransitions");
const { VALID_TICKET_TYPES } = require("../lib/ticketRouting");

const router = express.Router();
router.use(requireAuth);

async function getTicket(ticketId) {
    const result = await query(
        `SELECT t.*, p.name AS projectName, p.projectManagerId
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
//                   picks the Purchaser (assignedTo) now and, for a Material
//                   Request, sets the approvedBudget. PMs create Material Request
//                   or Work Item only (Reports are the SM's channel).
//
// ticketType is a category label only; it does not determine a recipient.
router.post("/", requireRole("Site Manager", "Project Manager"), async (req, res, next) => {
    try {
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
        } = req.body;

        const isPM = req.user.role === "Project Manager";
        const isSM = req.user.role === "Site Manager";

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
        if (isMaterialReq || isWorkItem) {
            if (quantity === undefined || quantity === null || !vendorName) {
                const err = new Error("Material Request and Work Item tickets require quantity and vendorName");
                err.status = 400;
                throw err;
            }
            if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
                const err = new Error("quantity must be a positive number");
                err.status = 400;
                throw err;
            }
        }

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

        // A PM-created ticket is born Acknowledged, so it needs its Purchaser now.
        if (isPM && (isMaterialReq || isWorkItem) && !assignedTo) {
            const err = new Error("assignedTo (a Purchaser's userId) is required when a Project Manager creates a ticket");
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

        if (isSM && project.sitemanagerid !== req.user.id) {
            const err = new Error("You may only create tickets on the project you are assigned to");
            err.status = 403;
            throw err;
        }
        if (isPM && project.projectmanagerid !== req.user.id) {
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

        // Validate the Purchaser the PM is assigning (same rules as /acknowledge).
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
            if (assignee.role !== "Purchaser") {
                const err = new Error(`assignedTo must be a Purchaser, but user ${assignedTo} is a ${assignee.role}`);
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

        // Creator-dependent columns.
        const status = isPM ? "Acknowledged" : "Pending";
        const requestedBudgetValue = isSM && isMaterialReq ? requestedBudget : null;
        const approvedBudgetValue = isPM && isMaterialReq ? approvedBudget : null;
        const assignedToValue = isPM ? assignedTo : null;
        const acknowledgedByValue = isPM ? req.user.id : null;
        const acknowledgedAtSql = isPM ? "NOW()" : "NULL"; // derived from role, not user input

        const ticket = await withTransaction(async (client) => {
            const insertResult = await client.query(
                `INSERT INTO tickets
                   (projectId, submittedBy, ticketType, subject, description, photoURL,
                    materialType, quantity, unit, vendorName, requestedBudget,
                    bomItemID, notInBom, notInBomReason,
                    status, assignedTo, acknowledgedBy, approvedBudget, acknowledgedAt)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, ${acknowledgedAtSql})
                 RETURNING *`,
                [
                    projectID,
                    req.user.id,
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
                ]
            );
            const newTicket = insertResult.rows[0];

            // Audit: every ticket is born Pending. A PM-created ticket is
            // acknowledged by the same action, so record that transition too.
            await logTransition(client, {
                ticketId: newTicket.ticketid,
                fromStatus: null,
                toStatus: "Pending",
                changedBy: req.user.id,
            });
            if (isPM) {
                await logTransition(client, {
                    ticketId: newTicket.ticketid,
                    fromStatus: "Pending",
                    toStatus: "Acknowledged",
                    changedBy: req.user.id,
                });
            }

            return newTicket;
        });

        res.status(201).json(ticket);
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
router.get("/assigned", requireRole("Purchaser"), async (req, res, next) => {
    try {
        const result = await query(
            "SELECT * FROM tickets WHERE assignedTo = $1 ORDER BY createdAt DESC",
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

// GET /purchasers — active Purchasers available to a PM for assignment.
router.get("/purchasers", requireRole("Project Manager"), async (req, res, next) => {
    try {
        const result = await query(
            `SELECT userId, name, email
               FROM users
              WHERE role = 'Purchaser' AND status = 'Active'
              ORDER BY name ASC`
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /submitted — tickets created by the calling user (Site Manager view).
// No role gate: the WHERE filter already scopes results to the caller's own
// tickets, so a PM/Purchaser hitting this just gets an empty list.
router.get("/submitted", async (req, res, next) => {
    try {
        const result = await query(
            `SELECT t.*, u.role AS rejectedByRole
               FROM tickets t
               LEFT JOIN users u ON u.userId = t.resolvedBy
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

        assertLegalTransition(ticket.status, "Acknowledged");

        const updated = await withTransaction(async (client) => {
            const updateResult = await client.query(
                `UPDATE tickets
                    SET status = 'Acknowledged', assignedTo = $1, acknowledgedBy = $2,
                        acknowledgedAt = NOW(), approvedBudget = $3, updatedAt = NOW()
                  WHERE ticketId = $4 AND status = $5
                  RETURNING *`,
                [assignedTo, req.user.id, approvedBudgetValue, req.params.id, ticket.status]
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

// PATCH /:id/resolve — Material Request/Work Item: assigned Purchaser only,
// Acknowledged -> Resolved. Report: Project Manager only, Pending ->
// Resolved directly — Report never goes through /acknowledge, so this is
// intentionally NOT run through assertLegalTransition (that table only
// knows Acknowledged -> Resolved; Pending -> Resolved is a Report-only
// exception, not a general state-machine rule).
router.patch("/:id/resolve", requireRole("Purchaser", "Project Manager"), async (req, res, next) => {
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
            if (req.user.role !== "Purchaser") {
                const err = new Error("Only the assigned Purchaser can resolve this ticket");
                err.status = 403;
                throw err;
            }
            if (ticket.assignedto !== req.user.id) {
                const err = new Error("Only the assigned Purchaser can resolve this ticket");
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
router.patch("/:id/reject", requireRole("Project Manager", "Purchaser"), async (req, res, next) => {
    try {
        const ticket = await getTicket(req.params.id);

        if (req.user.role === "Project Manager") {
            if (ticket.status !== "Pending") {
                const err = new Error("Project Manager may only reject a ticket while it is Pending");
                err.status = 409;
                throw err;
            }
        } else {
            // Purchaser
            if (ticket.assignedto !== req.user.id) {
                const err = new Error("Only the assigned Purchaser can reject this ticket");
                err.status = 403;
                throw err;
            }
            if (ticket.status !== "Acknowledged") {
                const err = new Error("Purchaser may only reject a ticket while it is Acknowledged");
                err.status = 409;
                throw err;
            }
        }

        assertLegalTransition(ticket.status, "Rejected");

        const updated = await withTransaction(async (client) => {
            const updateResult = await client.query(
                `UPDATE tickets
                    SET status = 'Rejected', resolvedBy = $1, resolvedAt = NOW(), updatedAt = NOW()
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

module.exports = router;