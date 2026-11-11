// adminVendors.js — Vendor Master List CRUD. System Administrator only.
// Receipts keep the vendor name as text (Expenses.vendorName), so a vendor can be removed
// without breaking old expenses; later receipts from it are simply screened as "not on the list".
const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { LIMITS, InputError, text, uuid } = require("../lib/inputRules");

const router = express.Router();
router.use(requireAuth, requireRole("System Administrator"));

const PERMIT_TYPES = ["Permit", "PTU", "ATP"];
const STATUSES = ["Approved", "Flagged"];
const TIN_RE = /^\d{3}-\d{3}-\d{3}(-\d{3,5})?$/;

const COLUMNS = `vendorID AS "vendorID", vendorName AS "vendorName", location,
  tin, birPermitType AS "birPermitType", birPermitNumber AS "birPermitNumber",
  approvalStatus AS "approvalStatus",
  createdAt AS "createdAt"`;

/** Read and check the typed fields. Throws one InputError naming the first problem. */
function readFields(body) {
  const vendorName = text(body?.vendorName, { field: "vendorName", label: "Vendor name", max: LIMITS.vendorName, required: true });
  const location = text(body?.location, { field: "location", label: "Location", max: 200 });
  const tin = text(body?.tin, { field: "tin", label: "TIN", max: 20 });
  if (tin && !TIN_RE.test(tin)) {
    throw new InputError("TIN must look like 123-456-789-00000", "tin");
  }
  const birPermitType = text(body?.birPermitType, { field: "birPermitType", label: "BIR permit type", max: 20 });
  if (birPermitType && !PERMIT_TYPES.includes(birPermitType)) {
    throw new InputError("BIR permit type must be Permit, PTU or ATP", "birPermitType");
  }
  const birPermitNumber = text(body?.birPermitNumber, { field: "birPermitNumber", label: "Permit number", max: 50 });
  if (birPermitNumber && !birPermitType) {
    throw new InputError("Choose the BIR permit type for this number", "birPermitType");
  }
  const approvalStatus = body?.approvalStatus === undefined ? "Approved" : body.approvalStatus;
  if (!STATUSES.includes(approvalStatus)) {
    throw new InputError("Status must be Approved or Flagged", "approvalStatus");
  }
  return { vendorName, location, tin, birPermitType, birPermitNumber: birPermitType ? birPermitNumber : null, approvalStatus };
}

function sendInputError(res, err) {
  return res.status(400).json({ error: err.message, fieldErrors: err.fieldErrors });
}

const serverError = (res, err) => {
  console.error("Vendor request failed:", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
};

// LIST
router.get("/", async (req, res) => {
  try {
    const r = await query(`SELECT ${COLUMNS} FROM VendorMasterList ORDER BY LOWER(vendorName)`);
    res.json(r.rows);
  } catch (err) {
    serverError(res, err);
  }
});

// CREATE
router.post("/", async (req, res) => {
  let f;
  try {
    f = readFields(req.body);
  } catch (err) {
    if (err instanceof InputError) return sendInputError(res, err);
    throw err;
  }
  try {
    const dup = await query("SELECT 1 FROM VendorMasterList WHERE LOWER(vendorName) = LOWER($1)", [f.vendorName]);
    if (dup.rowCount > 0) {
      return res.status(409).json({ error: "A vendor with this name is already on the list", fieldErrors: [{ field: "vendorName", message: "Already on the list" }] });
    }
    const r = await query(
      `INSERT INTO VendorMasterList (addedBy, vendorName, location, tin, birPermitType, birPermitNumber, approvalStatus)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS}`,
      [req.user.id, f.vendorName, f.location, f.tin, f.birPermitType, f.birPermitNumber, f.approvalStatus]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// UPDATE
router.patch("/:id", async (req, res) => {
  let id;
  let f;
  try {
    id = uuid(req.params.id, { field: "id", label: "Vendor" });
    f = readFields(req.body);
  } catch (err) {
    if (err instanceof InputError) return sendInputError(res, err);
    throw err;
  }
  try {
    const dup = await query(
      "SELECT 1 FROM VendorMasterList WHERE LOWER(vendorName) = LOWER($1) AND vendorID <> $2",
      [f.vendorName, id]
    );
    if (dup.rowCount > 0) {
      return res.status(409).json({ error: "A vendor with this name is already on the list", fieldErrors: [{ field: "vendorName", message: "Already on the list" }] });
    }
    const r = await query(
      `UPDATE VendorMasterList
          SET vendorName = $1, location = $2, tin = $3, birPermitType = $4,
              birPermitNumber = $5, approvalStatus = $6
        WHERE vendorID = $7
       RETURNING ${COLUMNS}`,
      [f.vendorName, f.location, f.tin, f.birPermitType, f.birPermitNumber, f.approvalStatus, id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "Vendor not found" });
    res.json(r.rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  let id;
  try {
    id = uuid(req.params.id, { field: "id", label: "Vendor" });
  } catch (err) {
    if (err instanceof InputError) return sendInputError(res, err);
    throw err;
  }
  try {
    const r = await query("DELETE FROM VendorMasterList WHERE vendorID = $1 RETURNING vendorID", [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: "Vendor not found" });
    res.json({ vendorID: id, deleted: true });
  } catch (err) {
    serverError(res, err);
  }
});

module.exports = router;
