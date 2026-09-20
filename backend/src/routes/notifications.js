// notifications.js — F3-adjacent: read/ack notifications created by
// milestoneProgress.js (ScheduleVarianceAlert) and, if added later, other
// notification producers. Recipient-scoped only — no cross-user access.
const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /mine — the calling user's notifications, newest first.
// ?unreadOnly=true filters to isRead = false.
router.get("/mine", async (req, res, next) => {
    try {
        const { unreadOnly } = req.query;
        const base = "SELECT * FROM notifications WHERE recipientId = $1";
        const result = unreadOnly === "true"
            ? await query(`${base} AND isRead = FALSE ORDER BY createdAt DESC`, [req.user.id])
            : await query(`${base} ORDER BY createdAt DESC LIMIT 50`, [req.user.id]);
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