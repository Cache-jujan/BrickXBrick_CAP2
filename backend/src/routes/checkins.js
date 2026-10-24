// checkins.js — daily progress check-ins (Morning / Midday / End of day).
//
//   Site Manager
//     GET   /today              the three slots for each Active project they run
//     POST  /photo              store ONE check-in photo, return its URL
//     POST  /                   send a check-in (same rules as the offline sync)
//   Project Manager (of the project) / General Manager (read only)
//     GET   /project/:projectId check-ins + a day-by-slot grid (?from=&to=)
//     PATCH /:id/review         Acknowledge or Flag one (PM only)
//
// A check-in never changes a task, a milestone or progress (see lib/dailyCheckin.js).
const express = require("express");
const multer = require("multer");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { uploadBuffer } = require("../lib/r2");
const { hasValidMagicBytes } = require("../lib/photoValidation");
const { isUUID } = require("../lib/uuid");
const { isIsoDate } = require("../lib/projectRules");
const {
  CheckinError,
  submitCheckin,
  loadToday,
  loadCheckinDetail,
  loadProjectCheckins,
  reviewCheckin,
} = require("../lib/dailyCheckin");

const router = express.Router();
router.use(requireAuth);

const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png"];
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

function receivePhoto(req, res, next) {
  photoUpload.single("photo")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "photo must be 10MB or smaller" : err.message;
      return res.status(400).json({ error: message });
    }
    return next(err);
  });
}

router.get("/today", requireRole("Site Manager"), async (req, res, next) => {
  try {
    res.json(await loadToday(req.user));
  } catch (err) {
    next(err);
  }
});

// GET /:id — one check-in the Site Manager sent, with the PM's review (if any).
// A single-segment id never clashes with /today or /project/:projectId.
router.get("/:id", requireRole("Site Manager"), async (req, res, next) => {
  try {
    res.json(await loadCheckinDetail(req.user, req.params.id));
  } catch (err) {
    next(err);
  }
});

// POST /photo — multipart: field "photo" (JPEG/PNG, <=10MB) and text field
// "projectId". The phone uploads each photo first (also when replaying a queued
// check-in), then sends only the URLs in the check-in itself.
router.post("/photo", requireRole("Site Manager"), receivePhoto, async (req, res, next) => {
  try {
    const projectId = req.body && req.body.projectId;
    if (!isUUID(projectId)) throw new CheckinError(404, "PROJECT_NOT_FOUND", "projectId must be the id of a project");
    const file = req.file;
    if (!file) throw new CheckinError(400, "MISSING_PHOTO", "photo is required");
    if (!ALLOWED_PHOTO_TYPES.includes(file.mimetype)) throw new CheckinError(400, "MISSING_PHOTO", "photo must be JPEG or PNG");
    if (!hasValidMagicBytes(file.buffer, file.mimetype)) {
      throw new CheckinError(400, "MISSING_PHOTO", "photo content does not match a valid JPEG or PNG file");
    }

    const project = await query("SELECT status, siteManagerId FROM projects WHERE projectId = $1", [projectId]);
    if (project.rowCount === 0) throw new CheckinError(404, "PROJECT_NOT_FOUND", `Project ${projectId} not found`);
    if (project.rows[0].sitemanagerid !== req.user.id) {
      throw new CheckinError(403, "NOT_YOUR_PROJECT", "You can only check in on a project you are the Site Manager of");
    }
    if (project.rows[0].status !== "Active") {
      throw new CheckinError(409, "PROJECT_NOT_ACTIVE", "Check-ins can only be made on an Active project");
    }

    const photoUrl = await uploadBuffer(file.buffer, { contentType: file.mimetype, keyPrefix: `checkins/${projectId}` });
    res.status(201).json({ photoUrl });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireRole("Site Manager"), async (req, res, next) => {
  try {
    const { checkin, replayed } = await submitCheckin({ user: req.user, input: req.body });
    res.status(replayed ? 200 : 201).json({ checkinId: checkin.checkinid, replayed });
  } catch (err) {
    next(err);
  }
});

router.get("/project/:projectId", requireRole("Project Manager", "General Manager"), async (req, res, next) => {
  try {
    const { projectId } = req.params;
    if (!isUUID(projectId)) throw new CheckinError(404, "PROJECT_NOT_FOUND", `Project ${projectId} not found`);
    const project = await query("SELECT projectManagerId FROM projects WHERE projectId = $1", [projectId]);
    if (project.rowCount === 0) throw new CheckinError(404, "PROJECT_NOT_FOUND", `Project ${projectId} not found`);
    // Same rule as the project page: the GM sees every project, a PM only their own.
    if (req.user.role === "Project Manager" && project.rows[0].projectmanagerid !== req.user.id) {
      throw new CheckinError(403, "NOT_YOUR_PROJECT", "You do not have access to this project");
    }
    const { from, to } = req.query;
    for (const value of [from, to]) {
      if (value !== undefined && !isIsoDate(value)) throw new CheckinError(400, "INVALID_FIELDS", "from and to must be dates (YYYY-MM-DD)");
    }
    res.json(await loadProjectCheckins(projectId, { from, to }));
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/review", requireRole("Project Manager"), async (req, res, next) => {
  try {
    const review = await reviewCheckin({
      user: req.user,
      checkinId: req.params.id,
      decision: req.body.decision,
      comment: req.body.comment,
    });
    res.json({ decision: review.decision, comment: review.comment, reviewedAt: review.reviewedat });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
