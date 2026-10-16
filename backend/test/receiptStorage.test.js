// receiptStorage.js against a fake R2: no network, no credentials.
const test = require("node:test");
const assert = require("node:assert/strict");
const { S3Client } = require("@aws-sdk/client-s3");

process.env.R2_ACCOUNT_ID = "acct";
process.env.R2_ACCESS_KEY = "key";
process.env.R2_SECRET_KEY = "secret";
process.env.R2_BUCKET = "bucket";
process.env.R2_PUBLIC_BASE_URL = "https://files.example.com";

const { storeReceiptImage, receiptImageExists } = require("../src/lib/receiptStorage");

const sent = [];
let headBehaviour = () => ({});
S3Client.prototype.send = async function fakeSend(command) {
  sent.push(command);
  if (command.constructor.name === "HeadObjectCommand") return headBehaviour(command);
  return {};
};

test("storeReceiptImage writes receipts/<uuid>.<ext> and returns the public URL", async () => {
  sent.length = 0;
  const url = await storeReceiptImage(Buffer.from("x"), "image/jpeg");
  assert.match(url, /^https:\/\/files\.example\.com\/receipts\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].input.Bucket, "bucket");
  assert.equal(sent[0].input.Key, url.replace("https://files.example.com/", ""));
  assert.equal(sent[0].input.ContentType, "image/jpeg");
});

test("PDF and PNG receipts are accepted, other types are rejected with 400", async () => {
  assert.match(await storeReceiptImage(Buffer.from("x"), "application/pdf"), /\.pdf$/);
  assert.match(await storeReceiptImage(Buffer.from("x"), "image/png"), /\.png$/);
  await assert.rejects(() => storeReceiptImage(Buffer.from("x"), "text/html"), (e) => e.status === 400);
});

test("receiptImageExists is true only for our receipt keys that are really in R2", async () => {
  const good = "https://files.example.com/receipts/11111111-2222-3333-4444-555555555555.png";
  headBehaviour = () => ({});
  assert.equal(await receiptImageExists(good), true);

  headBehaviour = () => { const e = new Error("nf"); e.name = "NotFound"; throw e; };
  assert.equal(await receiptImageExists(good), false);
});

test("receiptImageExists rejects foreign hosts, other prefixes and traversal without calling R2", async () => {
  sent.length = 0;
  for (const url of [
    "https://evil.example.com/receipts/11111111-2222-3333-4444-555555555555.png",
    "https://files.example.com/tasks/t1/11111111-2222-3333-4444-555555555555.png",
    "https://files.example.com/receipts/../secret.png",
    "https://files.example.com/receipts/not-a-uuid.png",
    "http://localhost:3000/receipts/files/11111111-2222-3333-4444-555555555555.png",
    null,
    undefined,
  ]) {
    assert.equal(await receiptImageExists(url), false, String(url));
  }
  assert.equal(sent.length, 0);
});

test("receiptImageExists throws (not false) when R2 cannot be checked", async () => {
  headBehaviour = () => { throw new Error("socket hang up"); };
  await assert.rejects(
    () => receiptImageExists("https://files.example.com/receipts/11111111-2222-3333-4444-555555555555.jpg"),
    /socket hang up/
  );
});