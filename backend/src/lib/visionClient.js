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

/**
 * Same OCR call, but also returns the word boxes (textAnnotations[1..]) that
 * the layout line-item extractor needs. textAnnotations[0] is the whole-page
 * blob and is skipped. Same shape as scripts/dump-vision-layout.js.
 */
async function extractTextAndWords(buffer, mimeType, { vision } = {}) {
  // F6.3: images:annotate rejects PDF bytes ("Bad image data"), so a PDF
  // goes to the files:annotate endpoint instead.
  if (mimeType === "application/pdf") {
    return extractTextAndWordsFromPdf(buffer, { vision });
  }

  const client = vision || getVisionClient();
  const [result] = await client.documentTextDetection({ image: { content: buffer } });
  const text = result.fullTextAnnotation ? result.fullTextAnnotation.text : "";
  const words = (result.textAnnotations || []).slice(1).map((w) => ({
    text: w.description,
    vertices: (w.boundingPoly && w.boundingPoly.vertices) || [],
  }));
  return { text, words };
}

// Vision's synchronous files:annotate reads the first 5 pages of an inline
// PDF. That covers receipts; a longer PDF is a document, not a receipt.
const PDF_MAX_PAGES = 5;

// Fallback size for a page whose width/height Vision didn't report.
const DEFAULT_PAGE_SIZE = 1000;

/**
 * OCR a PDF receipt (text-based or scanned) through files:annotate.
 * Returns the same { text, words } shape as the image path, so the parser
 * and the layout line-item extractor don't know the difference.
 */
async function extractTextAndWordsFromPdf(buffer, { vision } = {}) {
  const client = vision || getVisionClient();
  const [result] = await client.batchAnnotateFiles({
    requests: [
      {
        inputConfig: { content: buffer, mimeType: "application/pdf" },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        // pages omitted: Vision defaults to the first 5 pages, and listing a
        // page number the PDF doesn't have is an error.
      },
    ],
  });
  const fileResponse = result && result.responses && result.responses[0];
  return pdfResponseToTextAndWords(fileResponse);
}

function symbolsToText(word) {
  return (word.symbols || []).map((s) => s.text || "").join("");
}

/**
 * Pure mapper, unit-tested without calling Google.
 *
 * Image OCR returns word boxes in pixels (boundingPoly.vertices). PDF OCR
 * returns fractions of the page (boundingBox.normalizedVertices, 0..1), and
 * has no textAnnotations list, so the words are read out of
 * fullTextAnnotation.pages -> blocks -> paragraphs -> words instead.
 * Fractions are scaled back to page units, and each page is stacked below
 * the previous one so rows from page 2 never merge with rows from page 1.
 */
function pdfResponseToTextAndWords(fileResponse) {
  if (!fileResponse) throw new Error("Vision returned no response for the PDF");
  if (fileResponse.error && fileResponse.error.message) {
    throw new Error(`Vision PDF OCR failed: ${fileResponse.error.message}`);
  }

  const pageResponses = fileResponse.responses || [];
  const texts = [];
  const words = [];
  let yOffset = 0;
  let pageErrors = 0;

  for (const pageResponse of pageResponses.slice(0, PDF_MAX_PAGES)) {
    if (pageResponse.error && pageResponse.error.message) {
      pageErrors += 1;
      continue;
    }
    const annotation = pageResponse.fullTextAnnotation;
    if (!annotation) continue;
    if (annotation.text) texts.push(annotation.text);

    for (const page of annotation.pages || []) {
      const width = page.width || DEFAULT_PAGE_SIZE;
      const height = page.height || DEFAULT_PAGE_SIZE;

      for (const block of page.blocks || []) {
        for (const paragraph of block.paragraphs || []) {
          for (const word of paragraph.words || []) {
            const text = symbolsToText(word);
            const box = word.boundingBox || {};
            const normalized = box.normalizedVertices || [];
            if (!text || normalized.length !== 4) continue;
            words.push({
              text,
              vertices: normalized.map((v) => ({
                x: ((v && v.x) || 0) * width,
                y: ((v && v.y) || 0) * height + yOffset,
              })),
            });
          }
        }
      }
      yOffset += height;
    }
  }

  if (pageResponses.length > 0 && pageErrors === pageResponses.length) {
    throw new Error("Vision PDF OCR failed on every page");
  }

  return { text: texts.join("\n"), words };
}

module.exports = {
  getVisionClient,
  extractTextFromImage,
  extractTextAndWords,
  extractTextAndWordsFromPdf,
  pdfResponseToTextAndWords,
};