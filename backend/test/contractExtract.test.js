// F2: reading a contract (.docx) to propose the contract form's values.
// The fixture is a made-up contract in the same layout as the client's real one.
// Nothing is saved by the reader: the GM reviews every value.
const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { docxToText, readZipEntry, wordsToNumber, parseContractDate, parseContractText, extractContract } = require("../src/lib/contractExtract");

const CONTRACT_PARAGRAPHS = [
  "This Construction Contract Agreement is made as of the 12th day of NOVEMBER, 2026 by MARIA D. SANTOS for TWO (2) STOREY RESIDENTIAL BUILDING at BARANGAY SAMPLE, TALISAY CITY, CEBU hereinafter referred to as the OWNERS and SAMPLE BUILDERS represented by the Contractor Manager JUAN P. DELA CRUZ with office address at 1F SAMPLE BLDG., Talisay City, Cebu hereinafter referred to as the CONTRACTOR.",
  "a. Down Payment - Twenty Percent (20%) of the Total Contract Price.",
  "DOWN PAYMENT AMOUNT: ₱ 500,000.00",
  "c. Retention - Ten Percent (10%) of the Total Contract Price to be released upon Turn-Over.",
  "6. Contract Amount. - The CONTRACT AMOUNT shall be (P 2,500,000.00)",
  "The CONTRACTOR warrants that the construction shall be completed within ONE HUNDRED - TWENTY (120) working days, excluding Sundays & Holidays.",
  "All materials and workmanship are guaranteed by the CONTRACTOR for a period of twelve (12) months the date of the turn-over.",
];

const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function documentXml(paragraphs) {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(p)}</w:t></w:r></w:p>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

// A minimal zip with one entry, stored (method 0) or deflated (method 8).
function zip(name, content, method) {
  const data = Buffer.from(content, "utf8");
  const stored = method === 8 ? zlib.deflateRawSync(data) : data;
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(zlib.crc32(data), 14);
  local.writeUInt32LE(stored.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(zlib.crc32(data), 16);
  central.writeUInt32LE(stored.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const localPart = Buffer.concat([local, nameBuf, stored]);
  const centralPart = Buffer.concat([central, nameBuf]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}

const docx = (paragraphs, method = 8) => zip("word/document.xml", documentXml(paragraphs), method);

test("reads a stored and a deflated zip entry", () => {
  for (const method of [0, 8]) {
    assert.equal(readZipEntry(zip("word/document.xml", "<a/>", method), "word/document.xml").toString(), "<a/>");
  }
  assert.equal(readZipEntry(zip("other.xml", "<a/>", 8), "word/document.xml"), null);
});

test("something that is not a zip or a Word file is refused", () => {
  assert.throws(() => docxToText(Buffer.from("not a zip at all, just text")), /not a valid \.docx/);
  assert.throws(() => docxToText(zip("other.xml", "<a/>", 8)), /doesn't look like a Word document/);
});

test("the text keeps one line per paragraph and decodes symbols", () => {
  const text = docxToText(docx(["A & B <c>", "second"]));
  assert.equal(text, "A & B <c>\nsecond\n");
});

test("words are read as numbers", () => {
  assert.equal(wordsToNumber("Thirty"), 30);
  assert.equal(wordsToNumber("Twenty-Five"), 25);
  assert.equal(wordsToNumber("One Hundred"), 100);
  assert.equal(wordsToNumber("ONE HUNDRED - TWENTY"), 120);
  assert.equal(wordsToNumber("lots"), null);
});

test("the contract date is read from 'made as of the 12th day of NOVEMBER, 2026'", () => {
  assert.equal(parseContractDate("made as of the 12thday of NOVEMBER, 2026 by"), "2026-11-12");
  assert.equal(parseContractDate("made as of the 31st day of FEBRUARY, 2026"), null);
});

test("a contract in the client's layout fills the form", () => {
  const r = extractContract(docx(CONTRACT_PARAGRAPHS), "contract.docx");
  assert.deepEqual(r.fields, {
    contractDate: "2026-11-12",
    ownerName: "MARIA D. SANTOS",
    scope: "TWO (2) STOREY RESIDENTIAL BUILDING",
    siteLocation: "BARANGAY SAMPLE, TALISAY CITY, CEBU",
    contractorName: "SAMPLE BUILDERS",
    contractorRep: "Contractor Manager JUAN P. DELA CRUZ",
    contractorAddress: "1F SAMPLE BLDG., Talisay City, Cebu",
    contractAmount: 2500000,
    downPaymentPercent: 20,
    retentionPercent: 10,
    durationWorkingDays: 120,
    warrantyMonths: 12,
  });
  assert.equal(r.found, 6);
  assert.deepEqual(r.flags.filter((f) => f.level === "warning"), []);
});

test("a down payment written as 'Thirty Percent (40%)' is flagged and the amount wins", () => {
  const paragraphs = CONTRACT_PARAGRAPHS.map((p) =>
    p.startsWith("a. Down Payment") ? "a. Down Payment - Thirty Percent (40%) of the Total Contract Price." : p
  ).map((p) => (p.startsWith("DOWN PAYMENT AMOUNT") ? "DOWN PAYMENT AMOUNT: ₱ 1,000,000.00" : p));
  const r = parseContractText(docxToText(docx(paragraphs)));
  assert.equal(r.fields.downPaymentPercent, 40);
  const flag = r.flags.find((f) => f.field === "downPaymentPercent");
  assert.equal(flag.level, "warning");
  assert.match(flag.message, /the figure: 40%, the words: 30%, the amount: 40%/);
});

test("a down payment amount that doesn't match the percentage is flagged", () => {
  const paragraphs = CONTRACT_PARAGRAPHS.map((p) => (p.startsWith("DOWN PAYMENT AMOUNT") ? "DOWN PAYMENT AMOUNT: ₱ 100,000.00" : p));
  const r = parseContractText(docxToText(docx(paragraphs)));
  assert.ok(r.flags.some((f) => f.level === "warning" && f.field === "downPaymentPercent"));
});

test("fields that aren't in the document are listed as not found", () => {
  const r = parseContractText(docxToText(docx(["Some unrelated paragraph."])));
  assert.deepEqual(r.fields, {});
  assert.equal(r.found, 0);
  assert.deepEqual(r.flags.filter((f) => f.level === "info" && f.field).map((f) => f.field), [
    "contractDate", "ownerName", "contractorName", "contractAmount", "downPaymentPercent", "retentionPercent",
  ]);
});

test("PDFs and other types are refused with a clear message", () => {
  assert.throws(() => extractContract(Buffer.from("%PDF-1.7"), "contract.pdf"), /PDF and scanned contracts can't be read/);
  assert.throws(() => extractContract(Buffer.from("x"), "contract.txt"), /Word \.docx/);
});
