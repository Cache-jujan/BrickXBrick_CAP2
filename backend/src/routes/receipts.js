const express = require("express");
const multer = require("multer");
const vision = require("@google-cloud/vision");
const { parseReceiptText } = require("../../scripts/parser");

const router = express.Router();

// memoryStorage = keep the uploaded file in RAM as req.file.buffer,
// instead of writing it to disk. Fine for small receipt images.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // reject anything over 10MB
});

const client = new vision.ImageAnnotatorClient({
  keyFilename: process.env.GOOGLE_VISION_API_KEY,
});

// upload.single("file") = expect ONE file in the multipart body,
// under the form field name "file" — that name has to match what
// the phone sends (we'll match it up in Step 3).
router.post("/scan", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const [result] = await client.textDetection({
      image: { content: req.file.buffer }, // buffer instead of a file path
    });
    const text = result.fullTextAnnotation?.text || "";
    const parsed = parseReceiptText(text);

    res.json({ text, parsed });
  } catch (err) {
    console.error("OCR failed:", err);
    res.status(500).json({ error: "OCR failed" });
  }
});

module.exports = router;