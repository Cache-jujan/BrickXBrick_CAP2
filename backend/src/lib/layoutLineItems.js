// layoutLineItems.js — turns Vision word boxes into parser-shaped line items
// using extractLineItemsFromLayout (row clustering + header column mapping).
//
// Returns null when the layout pass can't find a table header or reads no
// usable rows, so the caller keeps the text-regex line items instead.

const { extractLineItemsFromLayout } = require("./extractLineItemsFromLayout");
const { normalizeAmount } = require("./parser");

// Vision omits zero-valued coordinates in some responses ({ y: 12 } with no
// x). Default them so the geometry math never sees undefined.
function cleanWords(words) {
  if (!Array.isArray(words)) return [];
  return words
    .filter((w) => w && typeof w.text === "string" && Array.isArray(w.vertices) && w.vertices.length === 4)
    .map((w) => ({ text: w.text, vertices: w.vertices.map((v) => ({ x: (v && v.x) ?? 0, y: (v && v.y) ?? 0 })) }));
}

function toNumber(text) {
  if (!text) return null;
  const n = normalizeAmount(String(text));
  return n === null || !Number.isFinite(Number(n)) ? null : Number(n);
}

const MONEY_TOKEN = /(?:^|\s)[P₱]?\s?(\d[\d,.]*\d|\d)(?=\s|$)/;
// Words from the totals block that often sit on the same visual row as an
// item, to the right of the table (VAT summary, "Total Amount Due").
const SUMMARY_WORDS = /\b(vat|total|less|discount|tax|due|add|net|change|cash)\b/i;

// "2,592.00 Less : 12 % VAT 1,070.04" -> "2,592.00"
// "Net of VAT / Total 8,916.96"       -> null (summary text before the number)
function firstAmountToken(text) {
  if (!text) return null;
  const m = MONEY_TOKEN.exec(String(text));
  if (!m) return null;
  if (SUMMARY_WORDS.test(String(text).slice(0, m.index))) return null;
  return m[1];
}

// When the qty column is empty the quantity often landed in "unit":
// "2.00 LENGTH FLAT" -> { qty: "2.00", unit: "LENGTH FLAT" }
function splitLeadingQty(row) {
  if (row.qty || !row.unit) return row;
  const m = /^(\d+(?:[.,]\d+)?)\s+(.*)$/.exec(row.unit);
  return m ? { ...row, qty: m[1], unit: m[2] } : row;
}

function lineItemsFromWords(words) {
  const cleaned = cleanWords(words);
  if (cleaned.length === 0) return null;

  const out = extractLineItemsFromLayout(cleaned);
  if (!out.headerFound) return null;

  const items = out.lineItems
    .map(splitLeadingQty)
    .map((row) => {
      const amount = toNumber(firstAmountToken(row.amount));
      const quantity = toNumber(row.qty);
      const unitPrice = toNumber(row.price);
      const description = [row.unit, row.description].filter(Boolean).join(" ").trim();
      return { description, quantity, unitPrice, amount };
    })
    .filter((item) => item.description && item.amount !== null);

  return items.length > 0 ? items : null;
}

module.exports = { lineItemsFromWords, cleanWords, firstAmountToken };
