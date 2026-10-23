// notifications.js — F3-adjacent: read/ack notifications created by
// milestoneProgress.js (ScheduleVarianceAlert) and, if added later, other
// notification producers. Recipient-scoped only — no cross-user access.
const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /mine — the calling user's notifications, newest first.
//   ?unreadOnly=true   only unread
//   ?before=<ISO ts>   keyset page: rows older than this createdAt (for "load more")
//   ?limit=<n>         page size (default 30, max 100)
// Ticket rows carry enough of the ticket (project/status/type/submitter) to
// deep-link straight to it without a second request.
router.get("/mine", async (req, res, next) => {
    try {
        const { unreadOnly, before } = req.query;
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);

        const params = [req.user.id];
        const where = ["n.recipientId = $1"];
        if (unreadOnly === "true") where.push("n.isRead = FALSE");
        if (before) {
            params.push(before);
            where.push(`n.createdAt < $${params.length}`);
        }
        params.push(limit);

        // Milestone/Task notifications carry the milestone's or task's own id
        // as relatedEntityId (see milestoneProgress.js) — join through to the
        // project id so the web app's notifications can deep-link straight to
        // "that project's milestones", the same way the Ticket join does.
        const result = await query(
            `SELECT n.*,
                    t.projectId   AS ticket_projectid,
                    t.status      AS ticket_status,
                    t.ticketType  AS ticket_type,
                    t.submittedBy AS ticket_submittedby,
                    t.createdAt   AS ticket_createdat,
                    m.projectId   AS milestone_projectid,
                    tm.projectId  AS task_projectid,
                    ck.projectId  AS checkin_projectid
               FROM notifications n
               LEFT JOIN tickets t
                 ON n.relatedEntityType = 'Ticket' AND t.ticketId = n.relatedEntityId
               LEFT JOIN milestones m
                 ON n.relatedEntityType = 'Milestone' AND m.milestoneId = n.relatedEntityId
               LEFT JOIN tasks tk
                 ON n.relatedEntityType = 'Task' AND tk.taskId = n.relatedEntityId
               LEFT JOIN milestones tm
                 ON tk.milestoneId = tm.milestoneId
               LEFT JOIN daily_progress_checkins ck
                 ON n.relatedEntityType = 'Checkin' AND ck.checkinId = n.relatedEntityId
              WHERE ${where.join(" AND ")}
              ORDER BY n.createdAt DESC
              LIMIT $${params.length}`,
            params
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /unread-count — lightweight endpoint for a bell badge, avoids
// pulling the full list just to show a number.
router.get("/unread-count", async (req, res, next) => {
    try {
        const result = await query(
            "SELECT COUNT(*)::int AS count FROM notifications WHERE recipientId = $1 AND isRead = FALSE",
            [req.user.id]
        );
        res.json({ count: result.rows[0].count });
    } catch (err) {
        next(err);
    }
});

// PATCH /:id/read — mark one notification read. Scoped to the owner —
// can't mark someone else's notification as read.
router.patch("/:id/read", async (req, res, next) => {
    try {
        const result = await query(
            "UPDATE notifications SET isRead = TRUE WHERE notificationId = $1 AND recipientId = $2 RETURNING *",
            [req.params.id, req.user.id]
        );
        if (result.rowCount === 0) {
            const err = new Error("Notification not found");
            err.status = 404;
            throw err;
        }
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// PATCH /read-all — mark every unread notification for the caller as read.
router.patch("/read-all", async (req, res, next) => {
    try {
        await query(
            "UPDATE notifications SET isRead = TRUE WHERE recipientId = $1 AND isRead = FALSE",
            [req.user.id]
        );
        res.json({ status: "ok" });
    } catch (err) {
        next(err);
    }
});

module.exports = router;