// F6.3 — PDF receipts go to Vision files:annotate, not images:annotate.
// A fake Vision client stands in for Google, so these run offline.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractTextAndWords,
  pdfResponseToTextAndWords,
} = require("../src/lib/visionClient");
const { lineItemsFromWords } = require("../src/lib/layoutLineItems");

// One Vision "word": symbols spell the text, the box is in page fractions.
function word(text, x0, y0, x1, y1) {
  return {
    symbols: [...text].map((ch) => ({ text: ch })),
    boundingBox: {
      normalizedVertices: [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
    },
  };
}

function pageResponse(text, words, width = 600, height = 800) {
  return {
    fullTextAnnotation: {
      text,
      pages: [{ width, height, blocks: [{ paragraphs: [{ words }] }] }],
    },
  };
}

function fakeVision(fileResponse) {
  const calls = { image: 0, files: [] };
  return {
    calls,
    async documentTextDetection() {
      calls.image += 1;
      return [{ fullTextAnnotation: { text: "IMG" }, textAnnotations: [] }];
    },
    async batchAnnotateFiles(request) {
      calls.files.push(request);
      return [{ responses: [fileResponse] }];
    },
  };
}

test("a PDF is sent to batchAnnotateFiles, never to the image endpoint", async () => {
  const vision = fakeVision({ responses: [pageResponse("HELLO", [word("HELLO", 0.1, 0.1, 0.3, 0.12)])] });
  const out = await extractTextAndWords(Buffer.from("%PDF-1.4"), "application/pdf", { vision });

  assert.equal(vision.calls.image, 0);
  assert.equal(vision.calls.files.length, 1);
  const req = vision.calls.files[0].requests[0];
  assert.equal(req.inputConfig.mimeType, "application/pdf");
  assert.equal(req.features[0].type, "DOCUMENT_TEXT_DETECTION");
  assert.equal(out.text, "HELLO");
});

test("an image still goes to documentTextDetection", async () => {
  const vision = fakeVision({ responses: [] });
  const out = await extractTextAndWords(Buffer.from("jpg"), "image/jpeg", { vision });
  assert.equal(vision.calls.image, 1);
  assert.equal(vision.calls.files.length, 0);
  assert.equal(out.text, "IMG");
});

test("PDF word boxes are scaled from page fractions to page units", () => {
  const out = pdfResponseToTextAndWords({
    responses: [pageResponse("CEMENT", [word("CEMENT", 0.1, 0.5, 0.3, 0.52)], 600, 800)],
  });
  assert.equal(out.words.length, 1);
  assert.equal(out.words[0].text, "CEMENT");
  assert.deepEqual(out.words[0].vertices[0], { x: 60, y: 400 });
  assert.deepEqual(out.words[0].vertices[2], { x: 180, y: 416 });
});

test("page 2 is stacked below page 1 and the text of both pages is kept", () => {
  const out = pdfResponseToTextAndWords({
    responses: [
      pageResponse("PAGE ONE", [word("ONE", 0.1, 0.1, 0.2, 0.12)], 600, 800),
      pageResponse("PAGE TWO", [word("TWO", 0.1, 0.1, 0.2, 0.12)], 600, 800),
    ],
  });
  assert.equal(out.text, "PAGE ONE\nPAGE TWO");
  assert.equal(out.words[0].vertices[0].y, 80);
  assert.equal(out.words[1].vertices[0].y, 880);
});

test("a file-level Vision error throws, so /scan falls back to manual entry", () => {
  assert.throws(
    () => pdfResponseToTextAndWords({ error: { message: "Bad PDF" } }),
    /Bad PDF/
  );
});

test("every page failing throws; one bad page out of two does not", () => {
  const bad = { error: { message: "page failed" } };
  assert.throws(() => pdfResponseToTextAndWords({ responses: [bad, bad] }), /every page/);

  const out = pdfResponseToTextAndWords({
    responses: [bad, pageResponse("OK", [word("OK", 0.1, 0.1, 0.2, 0.12)])],
  });
  assert.equal(out.text, "OK");
});

test("PDF words feed the layout line-item extractor like image words do", () => {
  // Header row then two item rows, laid out as a receipt table.
  const row = (y, cells) => cells.map(([t, x0, x1]) => word(t, x0, y, x1, y + 0.02));
  const words = [
    ...row(0.30, [["QTY", 0.05, 0.12], ["DESCRIPTION", 0.2, 0.45], ["AMOUNT", 0.75, 0.9]]),
    ...row(0.35, [["10", 0.05, 0.08], ["CEMENT", 0.2, 0.32], ["2,800.00", 0.75, 0.9]]),
    ...row(0.40, [["5", 0.05, 0.07], ["SAND", 0.2, 0.28], ["1,500.00", 0.75, 0.9]]),
  ];
  const out = pdfResponseToTextAndWords({ responses: [pageResponse("table", words)] });
  const items = lineItemsFromWords(out.words);

  assert.ok(items, "layout extractor found the table header");
  assert.equal(items.length, 2);
  assert.match(items[0].description, /CEMENT/);
  assert.equal(items[0].amount, 2800);
  assert.equal(items[1].amount, 1500);
});
