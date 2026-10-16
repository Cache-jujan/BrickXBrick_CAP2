// Receipt storage: byte check, canonical URL, and signed expiring links.
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

process.env.RECEIPT_STORAGE_DIR = path.join(os.tmpdir(), `receipts-${process.pid}`);
process.env.PUBLIC_BASE_URL = "http://api.test";
const rs = require("../src/lib/receiptStorage");

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

test("a file whose bytes don't match its declared type is refused", async () => {
  await assert.rejects(rs.storeReceiptImage(Buffer.from("<html><script>"), "image/png"), { status: 400 });
  await assert.rejects(rs.storeReceiptImage(JPEG, "application/pdf"), { status: 400 });
});

test("a real JPEG is stored and can be opened", async () => {
  const url = await rs.storeReceiptImage(JPEG, "image/jpeg");
  assert.match(url, /^http:\/\/api\.test\/receipts\/files\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(await rs.receiptImageExists(url), true);
  const file = await rs.openReceipt(rs.receiptFilename(url));
  assert.equal(file.contentType, "image/jpeg");
});

test("canonicalReceiptUrl re-bases a URL held under another host", () => {
  const name = "00000000-0000-4000-8000-000000000000.png";
  assert.equal(rs.canonicalReceiptUrl(`http://192.168.1.5:3000/receipts/files/${name}?exp=1&sig=x`), `http://api.test/receipts/files/${name}`);
  assert.equal(rs.canonicalReceiptUrl("http://x/receipts/files/../../etc/passwd"), null);
});

test("signed links verify, expire, and can't be reused for another file", () => {
  const url = "http://api.test/receipts/files/00000000-0000-4000-8000-000000000000.png";
  const now = Date.now();
  const q = new URL(rs.signReceiptUrl(url, now)).searchParams;
  const name = "00000000-0000-4000-8000-000000000000.png";
  assert.equal(rs.verifyReceiptSignature(name, q.get("exp"), q.get("sig"), now), true);
  assert.equal(rs.verifyReceiptSignature(name, q.get("exp"), q.get("sig"), now + 301_000), false);
  assert.equal(rs.verifyReceiptSignature("11111111-1111-4111-8111-111111111111.png", q.get("exp"), q.get("sig"), now), false);
  assert.equal(rs.verifyReceiptSignature(name, q.get("exp"), "0".repeat(64), now), false);
  assert.equal(rs.verifyReceiptSignature(name, undefined, undefined, now), false);
});
