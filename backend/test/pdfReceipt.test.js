const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");

const { preparePdfForOcr, OCR_MAX_PAGES } = require("../src/lib/pdfReceipt");

async function makePdf(pages, options) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([200, 200]);
  return Buffer.from(await doc.save(options));
}

// A normal PDF whose trailer also names an /Encrypt entry.
async function makeEncryptedPdf() {
  const text = (await makePdf(1, { useObjectStreams: false })).toString("latin1");
  return Buffer.from(text.replace("trailer\n<<", "trailer\n<< /Encrypt 1 0 R"), "latin1");
}

// A valid PDF whose page tree is empty.
const NO_PAGES = Buffer.from([
  "%PDF-1.4",
  "1 0 obj", "<< /Type /Catalog /Pages 2 0 R >>", "endobj",
  "2 0 obj", "<< /Type /Pages /Kids [] /Count 0 >>", "endobj",
  "trailer", "<< /Size 3 /Root 1 0 R >>", "%%EOF",
].join("\n"));

test("a short PDF is passed through unchanged", async () => {
  const pdf = await makePdf(2);
  const result = await preparePdfForOcr(pdf);
  assert.equal(result.pageCount, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.buffer, pdf);
});

test("a PDF at the page limit is not cut", async () => {
  const result = await preparePdfForOcr(await makePdf(OCR_MAX_PAGES));
  assert.equal(result.truncated, false);
});

test("a long PDF is cut to the first pages for OCR", async () => {
  const result = await preparePdfForOcr(await makePdf(8));
  assert.equal(result.pageCount, 8);
  assert.equal(result.truncated, true);
  const reread = await PDFDocument.load(result.buffer);
  assert.equal(reread.getPageCount(), OCR_MAX_PAGES);
});

test("an encrypted PDF is rejected with a clear 400", async () => {
  await assert.rejects(
    async () => preparePdfForOcr(await makeEncryptedPdf()),
    (err) => err.status === 400 && /password/i.test(err.message)
  );
});

test("garbage bytes are rejected as unreadable", async () => {
  await assert.rejects(
    () => preparePdfForOcr(Buffer.from("%PDF-1.4 this is not really a pdf")),
    (err) => err.status === 400 && /can't be read/i.test(err.message)
  );
});

test("a PDF with no pages is rejected", async () => {
  await assert.rejects(
    () => preparePdfForOcr(NO_PAGES),
    (err) => err.status === 400 && /no pages/i.test(err.message)
  );
});
