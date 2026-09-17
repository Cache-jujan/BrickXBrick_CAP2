const express = require("express");
const multer = require("multer");
const vision = require("@google-cloud/vision");
const { parseReceiptText } = require("../../scripts/parser");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");

const router = express.Router();
router.use(requireAuth); 

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const client = new vision.ImageAnnotatorClient({
  keyFilename: process.env.GOOGLE_VISION_API_KEY,
});

router.post(
  "/scan",
  requireRole("Purchaser", "General Manager", "Project Manager"), // F6 actor list
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      const [result] = await client.textDetection({
        image: { content: req.file.buffer },
      });
      const text = result.fullTextAnnotation?.text || "";
      const parsed = parseReceiptText(text);

      res.json({ text, parsed });
    } catch (err) {
      console.error("OCR failed:", err);
      res.status(500).json({ error: "OCR failed" });
    }
  }
);

module.exports = router;