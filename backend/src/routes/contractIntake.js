// contractIntake.js: start a new project from a signed contract.
// Mounted at /api/contract-intake (server.js).
//
//   POST /read   GM   multipart field "file" (.docx): read the contract and PROPOSE
//                     the New Project form's values. Nothing is saved.
//
// The proposal only fills the form. The GM edits it, creates the project, and the
// web app then saves the contract on the new project with the existing
// PUT /api/projects/:projectId/contract. A project with no contract yet is still
// created by hand as a Draft; activation still needs the contract (routes/projects.js).

const express = require("express");
const multer = require("multer");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { httpError, loadProjectSettings } = require("../lib/projectRules");
const { extractContract } = require("../lib/contractExtract");
const { proposeProjectFromContract } = require("../lib/contractIntake");

const router = express.Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

function sendError(res, err) {
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "The file is larger than 5 MB." : err.message;
    return res.status(400).json({ error: message });
  }
  if (!err.status) console.error("Contract intake error:", err);
  res.status(err.status || 500).json({ error: err.status ? err.message : "Internal server error", ...(err.details || {}) });
}

router.post("/read", requireRole("General Manager"), (req, res, next) => {
  upload.single("file")(req, res, (err) => (err ? sendError(res, err) : next()));
}, async (req, res) => {
  try {
    if (!req.file) throw httpError(400, 'Attach the contract file in the "file" field');
    const result = extractContract(req.file.buffer, req.file.originalname);
    const settings = await loadProjectSettings(query);
    const { proposal, suggested } = proposeProjectFromContract(result, { serviceArea: settings.serviceAreaMunicipalities });
    res.json({
      fileName: String(req.file.originalname).replace(/[^\w.\- ()]/g, "_").slice(0, 255),
      fields: result.fields,
      flags: result.flags,
      found: result.found,
      proposal,
      suggested,
    });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
