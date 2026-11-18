// Regression tests for D-07: evidence photos were accepted on the
// client-declared MIME type alone, so a text file, an HTML file, a 0-byte
// file, and a corrupt JPEG were all stored as if they were real photos.
const test = require("node:test");
const assert = require("node:assert/strict");

const { hasValidMagicBytes } = require("../src/lib/photoValidation");

test("a real JPEG passes", () => {
  const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.equal(hasValidMagicBytes(buffer, "image/jpeg"), true);
});

test("a real PNG passes", () => {
  const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  assert.equal(hasValidMagicBytes(buffer, "image/png"), true);
});

test("a text file declared as image/jpeg is rejected", () => {
  const buffer = Buffer.from("not a photo, just text", "utf8");
  assert.equal(hasValidMagicBytes(buffer, "image/jpeg"), false);
});

test("an HTML file declared as image/png is rejected", () => {
  const buffer = Buffer.from("<html><body>hi</body></html>", "utf8");
  assert.equal(hasValidMagicBytes(buffer, "image/png"), false);
});

test("a 0-byte file is rejected", () => {
  const buffer = Buffer.alloc(0);
  assert.equal(hasValidMagicBytes(buffer, "image/jpeg"), false);
  assert.equal(hasValidMagicBytes(buffer, "image/png"), false);
});

test("a corrupt JPEG (right type, wrong bytes) is rejected", () => {
  const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
  assert.equal(hasValidMagicBytes(buffer, "image/jpeg"), false);
});

test("a PNG's bytes declared as image/jpeg is rejected", () => {
  const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  assert.equal(hasValidMagicBytes(pngBuffer, "image/jpeg"), false);
});

test("an unsupported mimetype is always rejected", () => {
  const buffer = Buffer.from([0x47, 0x49, 0x46, 0x38]); // GIF signature
  assert.equal(hasValidMagicBytes(buffer, "image/gif"), false);
});

test("receipt files must really be a JPEG, PNG, WebP or PDF", () => {
  const { hasValidReceiptSignature } = require("../src/lib/photoValidation");
  assert.equal(hasValidReceiptSignature(Buffer.from("%PDF-1.7 body"), "application/pdf"), true);
  assert.equal(hasValidReceiptSignature(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]), "image/webp"), true);
  assert.equal(hasValidReceiptSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"), true);
  assert.equal(hasValidReceiptSignature(Buffer.from("<html>hi</html>"), "application/pdf"), false);
  assert.equal(hasValidReceiptSignature(Buffer.from("PK zip file"), "image/png"), false);
  assert.equal(hasValidReceiptSignature(Buffer.alloc(0), "image/jpeg"), false);
});
