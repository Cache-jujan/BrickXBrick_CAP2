// receiptFiles.js — serves stored receipts at /receipts/files/:name.
// Not public: needs a short-lived signed link from GET /api/receipts/link.

const express = require("express");
const { openReceipt, verifyReceiptSignature } = require("../lib/receiptStorage");

const router = express.Router();

router.get("/:name", async (req, res, next) => {
  try {
    const { exp, sig } = req.query;
    if (!verifyReceiptSignature(req.params.name, exp, sig)) {
      return res.status(403).json({ error: "This receipt link is invalid or has expired" });
    }
    const file = await openReceipt(req.params.name);
    if (!file) return res.status(404).json({ error: "Receipt not found" });

    res.set({
      "Content-Type": file.contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
    });
    if (Buffer.isBuffer(file.body)) return res.end(file.body);
    file.body.on("error", next);
    file.body.pipe(res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
