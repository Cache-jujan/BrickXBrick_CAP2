// Terms of Use and Privacy Notice (Data Privacy Act, RA 10173).
//
//   GET  /api/legal          anyone (no sign-in): the current text and version,
//                            so the login page can link to it
//   GET  /api/legal/status   signed-in user: have I accepted the current version?
//   POST /api/legal/accept   signed-in user: body { version } — records the
//                            acceptance with the time, IP address and device
//
// The web and mobile apps block everything else until the current version
// is accepted (user.termsAccepted from login and GET /api/me).
const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { TERMS_VERSION, legalDocuments } = require("../lib/legalTerms");

const router = express.Router();

// Has this user accepted the CURRENT version? Returns the acceptance time or null.
async function currentAcceptance(userId, runQuery = query) {
  const r = await runQuery(
    `SELECT acceptedAt FROM terms_acceptances
      WHERE userID = $1::uuid AND termsVersion = $2
      LIMIT 1`,
    [userId, TERMS_VERSION]
  );
  return r.rows[0]?.acceptedat || null;
}

// The fields added to the user object returned by login and GET /api/me.
// If migration 036 hasn't been run yet, don't lock everyone out: report the
// terms as accepted and log a warning so the missing migration is noticed.
async function termsFields(userId, runQuery = query) {
  try {
    const acceptedAt = await currentAcceptance(userId, runQuery);
    return { termsAccepted: Boolean(acceptedAt), termsVersion: TERMS_VERSION };
  } catch (err) {
    if (err.code === "42P01") {
      console.warn("terms_acceptances table missing — run migration 036 (npm run migrate)");
      return { termsAccepted: true, termsVersion: TERMS_VERSION };
    }
    throw err;
  }
}

router.get("/", (req, res) => {
  res.json(legalDocuments());
});

router.get("/status", requireAuth, async (req, res, next) => {
  try {
    const acceptedAt = await currentAcceptance(req.user.id);
    res.json({ version: TERMS_VERSION, accepted: Boolean(acceptedAt), acceptedAt });
  } catch (err) {
    next(err);
  }
});

router.post("/accept", requireAuth, async (req, res, next) => {
  try {
    const version = req.body?.version;
    if (version !== TERMS_VERSION) {
      return res.status(409).json({
        error: "The terms were updated while you were reading. Please review the latest version.",
        version: TERMS_VERSION,
      });
    }
    const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim().slice(0, 64) || null;
    const userAgent = String(req.headers["user-agent"] || "").slice(0, 300) || null;

    // Accepting twice is harmless: the first acceptance is the one on record.
    await query(
      `INSERT INTO terms_acceptances (userID, termsVersion, ipAddress, userAgent)
       VALUES ($1::uuid, $2, $3, $4)
       ON CONFLICT (userID, termsVersion) DO NOTHING`,
      [req.user.id, TERMS_VERSION, ip, userAgent]
    );
    const acceptedAt = await currentAcceptance(req.user.id);
    res.json({ version: TERMS_VERSION, accepted: true, acceptedAt });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.termsFields = termsFields;
