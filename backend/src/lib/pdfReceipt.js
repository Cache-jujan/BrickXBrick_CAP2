// pdfReceipt.js — checks a PDF receipt before it is stored and read by OCR.
//
// A receipt PDF is short. We read at most OCR_MAX_PAGES pages: the original
// file is stored whole, but only a copy holding the first pages goes to
// Gemini, so a long document can't run up the OCR cost or time out the scan.

const { PDFDocument } = require("pdf-lib");

const OCR_MAX_PAGES = 5;

function badPdf(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/**
 * Validate a PDF and return the bytes OCR should read.
 * Resolves to { buffer, pageCount, truncated }. Throws a 400 error for an
 * encrypted, unreadable or empty PDF, with a message the user can act on.
 */
async function preparePdfForOcr(buffer, maxPages = OCR_MAX_PAGES) {
  let doc;
  let pageCount;
  try {
    doc = await PDFDocument.load(buffer);
    // A file with no page tree loads fine but fails here.
    pageCount = doc.getPageCount();
  } catch (err) {
    // pdf-lib's EncryptedPDFError fails an instanceof check, so go by its message.
    if (/encrypted/i.test(err && err.message)) {
      throw badPdf("This PDF is password-protected. Remove the password, or take a photo of the receipt instead.");
    }
    throw badPdf("This PDF can't be read. Try another file, or take a photo of the receipt.");
  }

  if (pageCount === 0) throw badPdf("This PDF has no pages.");
  if (pageCount <= maxPages) return { buffer, pageCount, truncated: false };

  const firstPages = await PDFDocument.create();
  const copied = await firstPages.copyPages(doc, Array.from({ length: maxPages }, (_, i) => i));
  copied.forEach((page) => firstPages.addPage(page));
  return { buffer: Buffer.from(await firstPages.save()), pageCount, truncated: true };
}

module.exports = { preparePdfForOcr, OCR_MAX_PAGES };
