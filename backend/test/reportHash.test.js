// F11 report hash (canonicalizeReport in blockchainService.js). The hash must
// be repeatable from the stored report_events row, whatever the server's
// timezone, or an honest report would later look tampered with.
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { canonicalizeReport } = require("../src/lib/blockchainService");

const servicePath = path.join(__dirname, "../src/lib/blockchainService.js");
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function row(overrides = {}) {
  return {
    reportid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    generatedby: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    projectids: [P1, P2],
    periodfrom: "2026-10-01",
    periodto: "2026-10-31",
    generatedat: new Date("2026-10-16T01:00:00.000Z"),
    totals: {
      projects: [
        { projectId: P1, budget: 100000, periodSpend: 37000.5, cumulativeSpend: 49000.5, birDeductibleSpend: 22000 },
        { projectId: P2, budget: 50000, periodSpend: 57500, cumulativeSpend: 57500, birDeductibleSpend: 32500 },
      ],
    },
    ...overrides,
  };
}

test("identical input gives an identical 64-char hex hash", () => {
  const a = canonicalizeReport(row());
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, canonicalizeReport(row()));
});

test("project id order does not change the hash", () => {
  const reversed = row({
    projectids: [P2, P1],
    totals: { projects: [...row().totals.projects].reverse() },
  });
  assert.equal(canonicalizeReport(reversed), canonicalizeReport(row()));
});

test("changing any total by 0.01 changes the hash", () => {
  const base = canonicalizeReport(row());
  for (const field of ["budget", "periodSpend", "cumulativeSpend", "birDeductibleSpend"]) {
    const changed = row();
    changed.totals.projects[0][field] += 0.01;
    assert.notEqual(canonicalizeReport(changed), base, field);
  }
});

test("changing the id, user, period or time changes the hash", () => {
  const base = canonicalizeReport(row());
  assert.notEqual(canonicalizeReport(row({ reportid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" })), base);
  assert.notEqual(canonicalizeReport(row({ generatedby: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" })), base);
  assert.notEqual(canonicalizeReport(row({ periodto: "2026-10-30" })), base);
  assert.notEqual(canonicalizeReport(row({ generatedat: new Date("2026-10-16T01:00:00.001Z") })), base);
  assert.notEqual(canonicalizeReport(row({ projectids: [P1] })), base);
});

test("2-decimal formatting: 37000.5 and 37000.50 hash the same, -0 is not special", () => {
  const a = row();
  const b = row();
  b.totals.projects[0].periodSpend = "37000.50"; // as a string from JSONB
  assert.equal(canonicalizeReport(a), canonicalizeReport(b));
  const zero = row();
  zero.totals.projects[0].birDeductibleSpend = -0;
  const plain = row();
  plain.totals.projects[0].birDeductibleSpend = 0;
  assert.equal(canonicalizeReport(zero), canonicalizeReport(plain));
});

test("a report with no per-project totals cannot be hashed", () => {
  assert.throws(() => canonicalizeReport(row({ totals: {} })), /no per-project totals/);
});

test("the hash is the same under TZ=UTC and TZ=Asia/Manila", () => {
  // pg hands back DATE columns as a Date at the server's LOCAL midnight, so
  // build them the same way inside each child process.
  const script = `
    const { canonicalizeReport } = require(${JSON.stringify(servicePath)});
    const r = ${JSON.stringify(row())};
    r.periodfrom = new Date(2026, 9, 1);
    r.periodto = new Date(2026, 9, 31);
    r.generatedat = new Date(r.generatedat);
    process.stdout.write(canonicalizeReport(r));
  `;
  const hashIn = (tz) =>
    execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ: tz } }).toString();
  const utc = hashIn("UTC");
  const manila = hashIn("Asia/Manila");
  assert.equal(utc, manila);
  assert.equal(utc, canonicalizeReport(row())); // and equals the plain-string version
});
