// contractExtract.js: read a construction contract (.docx) and PROPOSE the
// values for the contract form. Nothing here saves anything: the GM reviews
// every value, and the checks below flag what doesn't add up (for example a
// down payment written as "Thirty Percent (40%)").
//
// A .docx is a zip file. The text is in word/document.xml, which is read with
// Node's built-in zlib, so no new package is needed. PDFs and scans are not
// read yet: the GM types the details (follow-up: OCR with Gemini).
//
// Pure functions (no database, no network) so they can be unit tested.

const zlib = require("zlib");
const { round2 } = require("./bomRules");
const { peso } = require("./contractRules");

const MAX_DOCUMENT_XML_BYTES = 20 * 1024 * 1024;

function unreadable(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// ---- zip reading ---------------------------------------------------------

/** The bytes of one file inside a zip, or null when it isn't there. */
function readZipEntry(buf, wantedName) {
  const EOCD = 0x06054b50;
  const CENTRAL = 0x02014b50;
  const LOCAL = 0x04034b50;
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw unreadable("The file is not a valid .docx document.");

  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i -= 1) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw unreadable("The file is not a valid .docx document.");

  const entries = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n += 1) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL) break;
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const size = buf.readUInt32LE(pos + 24);
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLength);
    pos += 46 + nameLength + extraLength + commentLength;
    if (name !== wantedName) continue;

    if (size > MAX_DOCUMENT_XML_BYTES) throw unreadable("The document is too large to read.");
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL) {
      throw unreadable("The file is not a valid .docx document.");
    }
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compressedSize);
    if (method === 0) return Buffer.from(raw);
    if (method === 8) {
      try {
        return zlib.inflateRawSync(raw, { maxOutputLength: MAX_DOCUMENT_XML_BYTES });
      } catch {
        throw unreadable("The document could not be read. Save it again as .docx and retry.");
      }
    }
    throw unreadable("The document uses a compression this reader doesn't support.");
  }
  return null;
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The plain text of a .docx, one line per paragraph. */
function docxToText(buf) {
  const xml = readZipEntry(buf, "word/document.xml");
  if (!xml) throw unreadable("This doesn't look like a Word document (.docx).");
  return xml
    .toString("utf8")
    .replace(/<w:tab\b[^>]*\/>/g, " ")
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tc>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, dec, hex, name) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return XML_ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/ /g, " ");
}

// ---- reading the numbers and words -----------------------------------------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** "Thirty" -> 30, "Twenty-Five" -> 25, "One Hundred" -> 100. null when not a number in words. */
function wordsToNumber(words) {
  const tokens = String(words || "").toLowerCase().split(/[\s-]+/).filter((w) => w && w !== "and");
  if (tokens.length === 0) return null;
  let total = 0;
  for (const token of tokens) {
    if (token in UNITS) total += UNITS[token];
    else if (token in TENS) total += TENS[token];
    else if (token === "hundred") total = (total || 1) * 100;
    else return null;
  }
  return total;
}

function toAmount(raw) {
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const MONEY = String.raw`(?:₱|PHP|P)?\s*([\d,]+(?:\.\d{1,2})?)`;

/** "20th day of OCTOBER, 2026" -> "2026-10-20" */
function parseContractDate(line) {
  const m = /(\d{1,2})\s*(?:st|nd|rd|th)?\s*day\s+of\s+([A-Za-z]+),?\s*(\d{4})/i.exec(line);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  const iso = `${m[3]}-${String(month + 1).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * A rate written as "Thirty Percent (40%)": the words and the figure. Returns
 * { words, figure } with null for whatever isn't there.
 */
function readRate(source, label) {
  const m = new RegExp(String.raw`${label}\s*[-–:]\s*([A-Za-z\- ]*?)\s*(?:Percent|Per\s*cent)\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*\)`, "i").exec(source);
  if (!m) return { words: null, figure: null };
  return { words: wordsToNumber(m[1]), figure: Number(m[2]) };
}

/**
 * Settle the down payment % from up to three readings: the figure in brackets,
 * the words, and the percentage the written down payment amount implies. The
 * value at least two of them agree on wins; otherwise the amount's reading
 * (money is the hardest to get wrong), then the figure. Disagreement is flagged.
 */
function settleRate({ figure, words, implied }, label, flags, field) {
  const readings = [
    ["the figure", figure],
    ["the words", words],
    ["the amount", implied],
  ].filter(([, v]) => typeof v === "number");
  if (readings.length === 0) return null;

  const same = (a, b) => Math.abs(a - b) < 0.05;
  let chosen = null;
  for (const [, v] of readings) {
    if (readings.filter(([, other]) => same(v, other)).length >= 2) {
      chosen = v;
      break;
    }
  }
  if (chosen === null) chosen = typeof implied === "number" ? implied : readings[0][1];

  if (!readings.every(([, v]) => same(v, chosen))) {
    flags.push({
      field,
      level: "warning",
      message: `${label} is not consistent in the contract (${readings
        .map(([source, v]) => `${source}: ${round2(v)}%`)
        .join(", ")}). Using ${round2(chosen)}%. Check it against the signed copy.`,
    });
  }
  return round2(chosen);
}

/**
 * Propose the contract fields from the contract's text.
 * Returns { fields, flags, found }:
 *   fields  values for the form (a key is missing when it wasn't found)
 *   flags   [{ field, level: "warning" | "info", message }]
 *   found   how many of the form's main fields were filled in
 */
function parseContractText(rawText) {
  const flat = String(rawText || "").replace(/\s+/g, " ").trim();
  const fields = {};
  const flags = [];

  const date = parseContractDate(flat);
  if (date) fields.contractDate = date;

  const parties = /\b(\d{4})\s+by\s+(.+?)\s+for\s+(.+?)\s+at\s+(.+?),?\s+hereinafter\s+referred\s+to\s+as\s+the\s+OWNERS?\b/i.exec(flat);
  if (parties) {
    fields.ownerName = parties[2].trim();
    fields.scope = parties[3].trim();
    fields.siteLocation = parties[4].trim();
  }

  const contractor = /\band\s+(.+?)\s+represented\s+by\s+(?:the\s+)?(.+?)\s+with\s+office\s+address\s+at\s+(.+?),?\s+hereinafter\s+referred\s+to\s+as\s+the\s+CONTRACTOR\b/i.exec(flat);
  if (contractor) {
    fields.contractorName = contractor[1].trim();
    fields.contractorRep = contractor[2].trim();
    fields.contractorAddress = contractor[3].trim();
  }

  const amountMatch = new RegExp(String.raw`CONTRACT\s+AMOUNT\s+shall\s+be\s*\(?\s*${MONEY}`, "i").exec(flat);
  const contractAmount = amountMatch ? toAmount(amountMatch[1]) : null;
  if (contractAmount) fields.contractAmount = contractAmount;

  // Down payment: the figure, the words and the written amount may disagree.
  const down = readRate(flat, "Down\\s*Payment");
  const downAmountMatch = new RegExp(String.raw`DOWN\s+PAYMENT\s+AMOUNT\s*:?\s*${MONEY}`, "i").exec(flat);
  const downAmount = downAmountMatch ? toAmount(downAmountMatch[1]) : null;
  const impliedDown = contractAmount && downAmount ? (downAmount / contractAmount) * 100 : null;
  const downPercent = settleRate({ ...down, implied: impliedDown }, "The down payment", flags, "downPaymentPercent");
  if (downPercent !== null) fields.downPaymentPercent = downPercent;

  const retention = readRate(flat, "Retention");
  const retentionPercent = settleRate({ ...retention, implied: null }, "The retention", flags, "retentionPercent");
  if (retentionPercent !== null) fields.retentionPercent = retentionPercent;

  const duration = /\((\d{1,4})\)\s*working\s+days/i.exec(flat) || /within\s+(\d{1,4})\s+working\s+days/i.exec(flat);
  if (duration) fields.durationWorkingDays = Number(duration[1]);

  const warranty = /for\s+a\s+period\s+of\s+(?:[A-Za-z\- ]*?)\((\d{1,3})\)\s*months?/i.exec(flat);
  if (warranty) fields.warrantyMonths = Number(warranty[1]);

  const expected = ["contractDate", "ownerName", "contractorName", "contractAmount", "downPaymentPercent", "retentionPercent"];
  for (const key of expected) {
    if (fields[key] === undefined) {
      flags.push({ field: key, level: "info", message: "Not found in the document. Type it in." });
    }
  }
  if (fields.contractAmount && downAmount && impliedDown !== null) {
    const expectedAmount = round2((fields.contractAmount * (fields.downPaymentPercent ?? impliedDown)) / 100);
    if (Math.abs(expectedAmount - downAmount) > 1) {
      flags.push({
        field: "downPaymentPercent",
        level: "warning",
        message: `The written down payment amount (${peso(downAmount)}) doesn't match ${fields.downPaymentPercent}% of the contract amount (${peso(expectedAmount)}).`,
      });
    }
  }
  flags.push({
    field: null,
    level: "info",
    message: "The contract has no start or end date, only a number of working days. The project's own dates are not changed.",
  });

  return { fields, flags, found: expected.filter((k) => fields[k] !== undefined).length };
}

/** Read an uploaded contract file. Only .docx is supported for now. */
function extractContract(buffer, fileName) {
  const name = String(fileName || "").toLowerCase();
  if (name.endsWith(".pdf")) {
    throw unreadable("PDF and scanned contracts can't be read automatically yet. Type the details in, or upload the Word (.docx) version.");
  }
  if (!name.endsWith(".docx")) throw unreadable("Upload the contract as a Word .docx file.");
  const result = parseContractText(docxToText(buffer));
  return { fileName: String(fileName), ...result };
}

module.exports = { readZipEntry, docxToText, wordsToNumber, parseContractDate, parseContractText, extractContract };
