// visionClient.js — builds the Google Cloud Vision client correctly.
//
// The bug this replaces: `keyFilename` expects a PATH to a service-account
// JSON file. Passing an API key string (GOOGLE_VISION_API_KEY) makes the
// library try to open a file named after your key and fail with ENOENT.
// The Vision Node client authenticates with a service account, not with an
// API key — GOOGLE_VISION_API_KEY should come out of .env entirely.
//
// Local dev  -> GOOGLE_APPLICATION_CREDENTIALS=./keystore/google-service-account.json
// Cloud Run  -> GOOGLE_SERVICE_ACCOUNT_JSON='<the whole JSON, one line>'
//               (no file on disk in a container image)

const path = require("path");
const { ImageAnnotatorClient } = require("@google-cloud/vision");

let client = null;

function getVisionClient() {
  if (client) return client;

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    let credentials;
    try {
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (err) {
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_JSON is set but is not valid JSON: " + err.message
      );
    }
    client = new ImageAnnotatorClient({ credentials });
    return client;
  }

  const keyFilename = path.resolve(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      path.join(__dirname, "../../keystore/google-service-account.json")
  );

  client = new ImageAnnotatorClient({ keyFilename });
  return client;
}

/**
 * Run document OCR over an image buffer and return the raw full text,
 * ready to hand to parseReceiptText().
 *
 * documentTextDetection outperforms textDetection on dense receipt tables;
 * both return the same `fullTextAnnotation.text` shape.
 */
async function extractTextFromImage(buffer) {
  const vision = getVisionClient();
  const [result] = await vision.documentTextDetection({ image: { content: buffer } });
  return result.fullTextAnnotation ? result.fullTextAnnotation.text : "";
}

module.exports = { getVisionClient, extractTextFromImage };