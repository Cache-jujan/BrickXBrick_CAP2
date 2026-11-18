// middleware/r2Urls.js: stored R2 URLs go out signed, signed URLs come back as stored.
const test = require("node:test");
const assert = require("node:assert/strict");
process.env.R2_ACCOUNT_ID = "acct";
process.env.R2_ACCESS_KEY = "key";
process.env.R2_SECRET_KEY = "secret";
process.env.R2_BUCKET = "bkt";
process.env.R2_PUBLIC_BASE_URL = "https://pub.test";
const r2 = require("../src/lib/r2");
const { makeSignResponseUrls, makeStoredUrlsFromRequest, collect, replace } = require("../src/middleware/r2Urls");

const BASE = "https://photos.test";
const sign = async (url) => `${url}?sig=1`;

function run(middleware, req) {
  const res = {
    sent: null,
    json(body) {
      this.sent = body;
      return this;
    },
  };
  return new Promise((resolve) => {
    middleware(req, res, () => resolve({ req, res }));
  });
}

async function respond(body, deps = { baseUrl: BASE, sign }) {
  const { res } = await run(makeSignResponseUrls(deps), {});
  res.json(body);
  await new Promise((r) => setImmediate(r));
  return res.sent;
}

test("every stored URL in a response is signed, however deep, and other strings are left alone", async () => {
  const body = {
    user: { avatarUrl: `${BASE}/avatars/u1/a.jpg`, name: "Sam" },
    photos: [`${BASE}/checkins/p/1.jpg`, "https://elsewhere.test/x.jpg"],
    rows: [{ photoevidenceurl: `${BASE}/tasks/t/1.jpg`, n: 3, when: new Date(0) }],
  };
  const out = await respond(body);
  assert.equal(out.user.avatarUrl, `${BASE}/avatars/u1/a.jpg?sig=1`);
  assert.deepEqual(out.photos, [`${BASE}/checkins/p/1.jpg?sig=1`, "https://elsewhere.test/x.jpg"]);
  assert.equal(out.rows[0].photoevidenceurl, `${BASE}/tasks/t/1.jpg?sig=1`);
  assert.equal(out.rows[0].n, 3);
  assert.ok(out.rows[0].when instanceof Date);
});

test("the object a route hands over is not edited (a cached row signs afresh next time)", async () => {
  const row = { url: `${BASE}/a.jpg` };
  const out = await respond({ row });
  assert.equal(row.url, `${BASE}/a.jpg`);
  assert.notEqual(out.row, row);
});

test("a body with no stored URL is sent as is; no bucket configured means no signing", async () => {
  const plain = { ok: true };
  assert.equal(await respond(plain), plain);
  const withUrl = { url: `${BASE}/a.jpg` };
  assert.equal(await respond(withUrl, { baseUrl: "", sign }), withUrl);
});

test("a URL that cannot be signed is sent as stored; the rest of the response is still signed", async () => {
  const flaky = async (url) => {
    if (url.endsWith("bad.jpg")) throw new Error("no credentials");
    return `${url}?sig=1`;
  };
  const out = await respond({ a: `${BASE}/bad.jpg`, b: `${BASE}/ok.jpg` }, { baseUrl: BASE, sign: flaky });
  assert.equal(out.a, `${BASE}/bad.jpg`);
  assert.equal(out.b, `${BASE}/ok.jpg?sig=1`);
});

test("a request body: signed URLs become the stored URL, in nested lists too", async () => {
  const toStored = (url) => (url.startsWith("https://acct.r2.test/bucket/") ? `${BASE}/${url.split("?")[0].slice("https://acct.r2.test/bucket/".length)}` : null);
  const req = {
    body: {
      receiptImageURL: "https://acct.r2.test/bucket/receipts/r1.jpg?X-Amz-Signature=abc",
      photoUrls: ["https://acct.r2.test/bucket/ticket-photos/a.jpg?X-Amz-Signature=abc", `${BASE}/ticket-photos/b.jpg`],
      note: "plain",
    },
  };
  await run(makeStoredUrlsFromRequest({ toStored }), req);
  assert.equal(req.body.receiptImageURL, `${BASE}/receipts/r1.jpg`);
  assert.deepEqual(req.body.photoUrls, [`${BASE}/ticket-photos/a.jpg`, `${BASE}/ticket-photos/b.jpg`]);
  assert.equal(req.body.note, "plain");
});

test("collect and replace only walk arrays and plain objects", () => {
  const found = collect({ a: ["x", { b: "x" }], c: Buffer.from("x"), d: new Date(0) }, (s) => s === "x");
  assert.deepEqual([...found], ["x"]);
  const same = { n: 1 };
  assert.equal(replace(same, new Map([["x", "y"]])), same);
});

test("r2: a stored URL is signed for an hour, and the signed URL maps back to the stored one", async () => {
  const stored = "https://pub.test/checkins/p1/abc.jpg";
  const signed = await r2.getSignedReadUrlFromPublicUrl(stored);
  assert.ok(signed.includes("X-Amz-Signature="));
  assert.ok(signed.includes("X-Amz-Expires=3600"));
  assert.equal(r2.storedUrlFromSignedUrl(signed), stored);
  assert.equal(await r2.getSignedReadUrlFromPublicUrl("https://elsewhere.test/x.jpg"), null);
  assert.equal(r2.storedUrlFromSignedUrl("https://elsewhere.test/bkt/x.jpg"), null);
});
