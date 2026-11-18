// purchaseOrders.js: the printable Purchase Order (Purchaser, Site Manager, Project Manager, General Manager).
// The PDF is built on the phone or in the browser from the open requests the app already has,
// so the server stores no PO. It only issues the next number.
//
//   POST /number   -> 200 { poNumber: "PO-2026-014" }
const express = require("express");
const { query } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { PO_ROLES, nextPoNumber } = require("../lib/poNumber");

const router = express.Router();
router.use(requireAuth);

router.post("/number", requireRole(...PO_ROLES), async (req, res, next) => {
  try {
    res.json({ poNumber: await nextPoNumber(query) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
