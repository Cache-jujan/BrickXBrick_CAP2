const express = require("express");
const { query } = require("../lib/db");

const router = express.Router();

router.post("/", async (req, res) => {
  const { uuid, payload } = req.body;

  if (!uuid || !payload) {
    return res.status(400).json({ error: "uuid and payload are required" });
  }

  try {
    // Check if we've already synced this UUID
    const existing = await query(
      `SELECT uuid FROM sync_test_records WHERE uuid = $1`,
      [uuid]
    );

    if (existing.rowCount > 0) {
      return res.status(200).json({ status: "already_synced", uuid });
    }

    // New record — save it
    await query(
      `INSERT INTO sync_test_records (uuid, payload) VALUES ($1, $2)`,
      [uuid, payload]
    );

    return res.status(201).json({ status: "synced", uuid });
  } catch (err) {
    console.error("SYNC ERROR:", err); 
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;