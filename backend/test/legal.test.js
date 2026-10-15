// Terms of Use / Privacy Notice: the text is complete and the acceptance
// check reports the right state (routes/legal.js termsFields).
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_JWKS_URL = process.env.SUPABASE_JWKS_URL || "https://example.invalid/jwks";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.invalid";

const { TERMS_VERSION, legalDocuments } = require("../src/lib/legalTerms");
const { termsFields } = require("../src/routes/legal");

test("legal text: both documents, every section has content", () => {
  const d = legalDocuments();
  assert.equal(d.version, TERMS_VERSION);
  assert.deepEqual(d.documents.map((x) => x.id), ["terms", "privacy"]);
  for (const doc of d.documents) {
    assert.ok(doc.sections.length >= 5, `${doc.title} has too few sections`);
    for (const s of doc.sections) {
      assert.ok(s.heading, "section without a heading");
      assert.ok((s.paragraphs || []).length + (s.bullets || []).length > 0, `${s.heading} is empty`);
    }
  }
});

test("at-a-glance summary: four short points, each with a title and text", () => {
  const { highlights } = legalDocuments();
  assert.equal(highlights.length, 4);
  for (const h of highlights) {
    assert.ok(h.id && h.icon && h.title && h.text, "highlight missing a field");
    assert.ok(h.text.length <= 160, `"${h.title}" summary is too long for a card`);
  }
});

test("privacy notice names the Data Privacy Act, the rights and the NPC", () => {
  const text = JSON.stringify(legalDocuments());
  assert.match(text, /Republic Act No\. 10173/);
  assert.match(text, /National Privacy Commission/);
  assert.match(text, /access your personal data/);
  assert.match(text, /Republic Act No\. 10175/);
  assert.match(text, /Republic Act No\. 8792/);
});

test("termsFields: accepted when a row exists for the current version", async () => {
  let params;
  const fake = async (sql, p) => {
    params = p;
    return { rows: [{ acceptedat: new Date() }] };
  };
  assert.deepEqual(await termsFields("u1", fake), { termsAccepted: true, termsVersion: TERMS_VERSION });
  assert.deepEqual(params, ["u1", TERMS_VERSION]);
});

test("termsFields: not accepted when there is no row (new user or new version)", async () => {
  const fake = async () => ({ rows: [] });
  assert.deepEqual(await termsFields("u1", fake), { termsAccepted: false, termsVersion: TERMS_VERSION });
});

test("termsFields: missing table (migration 036 not run) does not lock everyone out", async () => {
  const fake = async () => {
    const e = new Error("relation does not exist");
    e.code = "42P01";
    throw e;
  };
  assert.equal((await termsFields("u1", fake)).termsAccepted, true);
});

test("termsFields: other database errors are not hidden", async () => {
  const fake = async () => {
    throw new Error("connection lost");
  };
  await assert.rejects(termsFields("u1", fake), /connection lost/);
});
