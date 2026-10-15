// F2: reads the client's Bill of Materials (.xlsx) into sections and items.
//
// The company's BOM always uses the same layout (client, Oct 2026):
//
//   PROJECT / LOCATION / OWNER / ADDRESS      <- header block, never stored
//   SCOPE | DESCRIPTION | QUANTITY | UNIT | UNIT COST | COST | TOTAL
//   STRUCTURAL                                <- section (text in SCOPE)
//         DEFORMED BAR 16MM | 110 | lengths | 420 | =C*E
//         ...
//                               MATERIAL COST | =SUM(...)
//                               LABOR COST    | =G35*0.5   (or a typed amount)
//   PLUMBING
//   ROUGHING-INS & FIXTURES/ACCESSORIES       <- sub-heading (second text row)
//   ...
//   GLASS WALLS AND DOORS ... LABOR-MATERIAL COST   <- labor is in the prices
//   TOTAL PROJECT COST: | =SUM(...)
//   PREPARED BY: ...                          <- footer, never stored
//
// parseBomRows() is pure (rows in, sections out) so it can be unit tested
// without a file. parseBomWorkbook() reads the .xlsx with exceljs and only
// takes cell values and formula text; formulas are never evaluated or run.
const { guessCostCategory } = require("./bomRules");

const LABEL = {
  MATERIALCOST: "material",
  TOTALMATERIALS: "material",
  TOTALMATERIALCOST: "material",
  MATERIALSCOST: "material",
  LABORCOST: "labor",
  LABOURCOST: "labor",
  LABORMATERIALCOST: "laborIncluded",
  LABORANDMATERIALCOST: "laborIncluded",
  MATERIALANDLABORCOST: "laborIncluded",
  TOTALPROJECTCOST: "total",
  TOTALCOST: "total",
  GRANDTOTAL: "total",
  // A section given as one amount, e.g. "DEMOLITION & HAULING ... COST 15,000"
  COST: "lumpsum",
  LUMPSUM: "lumpsum",
  LOTCOST: "lumpsum",
};

// Currency markers that sit in their own cell next to an amount ("PHP 49,159").
const CURRENCY_TEXT = new Set(["PHP", "P", "PESO", "PESOS"]);

const MAX_ITEMS = 2000;

// "M ATERIAL COST" -> "MATERIALCOST"
function normLabel(text) {
  return String(text).toUpperCase().replace(/[^A-Z]/g, "");
}

function cleanText(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s.length ? s : null;
}

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const s = value.replace(/PHP/gi, "").replace(/[₱,\s]/g, "");
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  }
  return null;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function colLetterToIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// "=G35*0.5", "G35*0.5", "0.5*$G$35" -> { row: 35, rate: 0.5 }
function parseRateFormula(formula) {
  if (!formula) return null;
  const f = String(formula).replace(/^=/, "").replace(/\$/g, "").replace(/\s+/g, "");
  let m = f.match(/^([A-Z]{1,3})(\d+)\*(\d+(?:\.\d+)?)$/i);
  if (m) return { col: colLetterToIndex(m[1]), row: Number(m[2]), rate: Number(m[3]) };
  m = f.match(/^(\d+(?:\.\d+)?)\*([A-Z]{1,3})(\d+)$/i);
  if (m) return { col: colLetterToIndex(m[2]), row: Number(m[3]), rate: Number(m[1]) };
  m = f.match(/^([A-Z]{1,3})(\d+)\*(\d+(?:\.\d+)?)%$/i);
  if (m) return { col: colLetterToIndex(m[1]), row: Number(m[2]), rate: Number(m[3]) / 100 };
  return null;
}

const HEADER_KEYS = {
  SCOPE: "scope",
  DESCRIPTION: "description",
  QUANTITY: "quantity",
  QTY: "quantity",
  UNIT: "unit",
  UNITCOST: "unitCost",
  UNITPRICE: "unitCost",
  COST: "cost",
  AMOUNT: "cost",
  TOTAL: "total",
};

function findHeader(rows) {
  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row) continue;
    const cols = {};
    row.forEach((cell, c) => {
      if (!cell || typeof cell.v !== "string") return;
      const key = HEADER_KEYS[normLabel(cell.v)];
      if (key && cols[key] === undefined) cols[key] = c;
    });
    if (cols.description && cols.quantity && cols.unit && cols.unitCost) {
      return { headerRow: r, cols };
    }
  }
  return null;
}

/**
 * rows: rows[rowNumber][colNumber] = { v: value, f: formulaText|null }, 1-based.
 * Returns { sections, statedTotal, skippedRows, rowWarnings }.
 */
function parseBomRows(rows) {
  const header = findHeader(rows);
  if (!header) {
    const err = new Error(
      "This file doesn't look like a Bill of Materials: no header row with DESCRIPTION, QUANTITY, UNIT and UNIT COST was found."
    );
    err.status = 400;
    throw err;
  }
  const { headerRow, cols } = header;
  const scopeCol = cols.scope || Math.max(1, cols.description - 1);

  const sections = [];
  const skippedRows = [];
  const rowWarnings = [];
  let statedTotal = null;
  let current = null;
  let itemCount = 0;
  // row number -> section, for "=G35*0.5" labor formulas
  const materialRowToSection = new Map();

  const cell = (row, c) => (c && row ? row[c] || null : null);
  const valueAt = (row, c) => cell(row, c)?.v ?? null;

  function newSection(name, rowNumber) {
    current = {
      name,
      subheading: null,
      sourceRow: rowNumber,
      laborRate: null,
      laborAmount: null,
      laborIncludedInItems: false,
      statedMaterialTotal: null,
      statedLaborAmount: null,
      items: [],
      closed: false, // a summary row (MATERIAL COST, LABOR COST, COST) has been read
    };
    sections.push(current);
    return current;
  }

  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row) continue;

    const texts = [];
    row.forEach((c, idx) => {
      if (c && typeof c.v === "string" && c.v.trim()) texts.push({ idx, text: c.v });
    });

    // Footer: stop before names, registration numbers and signatures.
    if (texts.some((t) => /^(PREPAREDBY|APPROVEDBY|CHECKEDBY|CONFORME|NOTED)/.test(normLabel(t.text)))) break;

    // Summary rows: MATERIAL COST, LABOR COST, TOTAL PROJECT COST, ...
    const labelCell = texts.find((t) => LABEL[normLabel(t.text)]);
    if (labelCell) {
      const kind = LABEL[normLabel(labelCell.text)];
      let amountCell = cell(row, cols.total);
      if (asNumber(amountCell?.v) === null) {
        // fall back to the first number to the right of the label
        amountCell = null;
        for (let c = labelCell.idx + 1; c < row.length; c += 1) {
          if (asNumber(row[c]?.v) !== null) {
            amountCell = row[c];
            break;
          }
        }
      }
      const amount = asNumber(amountCell?.v);

      if (kind === "total") {
        statedTotal = amount === null ? null : round2(amount);
        continue;
      }
      if (kind === "lumpsum") {
        // "DEMOLITION & HAULING  ...  COST  15,000": a service section given as one
        // amount, with no material lines. Kept as the section's fixed amount
        // (part of the total, never purchased against).
        const scopeName = cleanText(valueAt(row, scopeCol));
        const nameOnRow = scopeName && normLabel(scopeName) !== normLabel(labelCell.text) ? scopeName : null;
        if (amount === null) {
          rowWarnings.push({ row: r, message: `Row ${r}: "${cleanText(labelCell.text)}" has no amount and was ignored.` });
          continue;
        }
        if (nameOnRow) {
          newSection(nameOnRow.slice(0, 150), r);
        } else if (!current || current.items.length > 0 || current.closed) {
          if (current && current.items.length > 0 && current.statedMaterialTotal === null) {
            current.statedMaterialTotal = round2(amount); // "COST" used as the material subtotal
            current.closed = true;
            materialRowToSection.set(r, current);
            continue;
          }
          rowWarnings.push({ row: r, message: `Row ${r}: an amount of ₱${amount} without a section name was ignored.` });
          continue;
        }
        current.laborAmount = round2(amount);
        current.statedLaborAmount = round2(amount);
        current.closed = true;
        continue;
      }
      if (!current) {
        rowWarnings.push({ row: r, message: `Row ${r}: "${cleanText(labelCell.text)}" appears before any section and was ignored.` });
        continue;
      }
      current.closed = true;
      if (kind === "material") {
        current.statedMaterialTotal = amount === null ? null : round2(amount);
        materialRowToSection.set(r, current);
      } else if (kind === "laborIncluded") {
        current.laborIncludedInItems = true;
        current.statedMaterialTotal = amount === null ? null : round2(amount);
        materialRowToSection.set(r, current);
      } else if (kind === "labor") {
        const rate = parseRateFormula(amountCell?.f);
        if (rate && materialRowToSection.get(rate.row) === current && rate.rate >= 0 && rate.rate <= 10) {
          current.laborRate = rate.rate;
        } else if (amount !== null && amount >= 0) {
          current.laborAmount = round2(amount);
        }
        current.statedLaborAmount = amount === null ? null : round2(amount);
      }
      continue;
    }

    const scopeText = cleanText(valueAt(row, scopeCol));
    const description = cleanText(typeof valueAt(row, cols.description) === "string" ? valueAt(row, cols.description) : null);
    const quantity = asNumber(valueAt(row, cols.quantity));
    const unitCost = asNumber(valueAt(row, cols.unitCost));
    const unitRaw = valueAt(row, cols.unit);
    const unit = cleanText(unitRaw === null ? null : String(unitRaw));

    // An amount with a label but no item: a lump-sum section, a subtotal, or
    // an extra cost such as "OVERHEAD SUPERVISION" (spelling varies, e.g.
    // "OVEHEAD"). Subtotals ("TOTAL LABMAT COST") are skipped so nothing is
    // counted twice; anything else is kept as its own fixed cost line.
    if (!description && quantity === null) {
      const labelTexts = texts.filter((t) => !CURRENCY_TEXT.has(normLabel(t.text)) && asNumber(t.text) === null);
      let amountHere = asNumber(valueAt(row, cols.total));
      if (amountHere === null && labelTexts.length) {
        for (let c = labelTexts[0].idx + 1; c < row.length; c += 1) {
          if (asNumber(row[c]?.v) !== null) {
            amountHere = asNumber(row[c].v);
            break;
          }
        }
      }
      if (amountHere !== null && labelTexts.length) {
        const name = cleanText((scopeText || labelTexts[0].text).replace(/:\s*$/, ""));
        const key = normLabel(name);
        if (key.startsWith("TOTAL") || key.startsWith("SUBTOTAL")) continue; // a subtotal
        newSection(name.slice(0, 150), r);
        current.laborAmount = round2(amountHere);
        current.statedLaborAmount = round2(amountHere);
        current.closed = true;
        if (!scopeText) {
          rowWarnings.push({
            row: r,
            message: `Row ${r}: "${name}" (₱${round2(amountHere).toLocaleString("en-PH")}) was added as a separate fixed cost. It counts in the total but is not purchased, and it won't change if you edit items.`,
          });
        }
        continue;
      }
    }

    // Section header (or the sub-heading right after it)
    if (scopeText && !description && quantity === null) {
      if (current && current.items.length === 0 && !current.subheading && !current.closed) {
        current.subheading = scopeText.slice(0, 200);
      } else {
        newSection(scopeText.slice(0, 150), r);
      }
      continue;
    }

    if (!description && quantity === null && unitCost === null) continue; // blank or stray cell

    // An item row
    const problems = [];
    if (!description) problems.push("no description");
    if (quantity === null) problems.push("no quantity");
    else if (quantity <= 0) problems.push("quantity is not more than 0");
    if (!unit) problems.push("no unit");
    if (unitCost === null) problems.push("no unit cost");
    else if (unitCost < 0) problems.push("unit cost is negative");
    if (problems.length) {
      skippedRows.push({ row: r, description: description || null, reason: problems.join(", ") });
      continue;
    }

    if (!current) {
      newSection("GENERAL", r);
      rowWarnings.push({ row: r, message: `Row ${r}: items before the first section were put under "GENERAL".` });
    }

    itemCount += 1;
    if (itemCount > MAX_ITEMS) {
      const err = new Error(`The BOM has more than ${MAX_ITEMS} items; please check the file.`);
      err.status = 400;
      throw err;
    }

    const item = {
      description: description.slice(0, 200),
      quantity: round2(quantity),
      unit: unit.slice(0, 30),
      unitCost: round2(unitCost),
      sourceRow: r,
    };
    const writtenCost = asNumber(valueAt(row, cols.cost));
    if (writtenCost !== null && Math.abs(writtenCost - item.quantity * item.unitCost) > 0.01) {
      rowWarnings.push({
        row: r,
        message: `Row ${r} (${item.description}): the file's cost ₱${writtenCost} doesn't equal quantity × unit cost.`,
      });
    }
    current.items.push(item);
  }

  if (itemCount === 0) {
    const err = new Error("No material rows were found in this file.");
    err.status = 400;
    throw err;
  }

  sections.forEach((s) => {
    delete s.closed;
    s.costCategory = guessCostCategory(s); // adviser item 6; the GM can change it
  });
  return { sections, statedTotal, skippedRows, rowWarnings };
}

// exceljs cell value -> { v, f }
function plainCell(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || value instanceof Date) {
    return { v: value instanceof Date ? value.toISOString() : value, f: null };
  }
  if (value.richText) return { v: value.richText.map((p) => p.text).join(""), f: null };
  if (value.formula !== undefined || value.sharedFormula !== undefined) {
    const result = value.result;
    const v = result && typeof result === "object" ? null : result ?? null; // {error: '#REF!'} -> null
    return { v, f: value.formula || null };
  }
  if (value.text !== undefined) return { v: value.text, f: null }; // hyperlink
  if (value.error) return { v: null, f: null };
  return null;
}

async function parseBomWorkbook(buffer) {
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    const err = new Error("The file could not be read as an Excel (.xlsx) workbook.");
    err.status = 400;
    throw err;
  }

  let firstError = null;
  for (const sheet of workbook.worksheets) {
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells = [];
      row.eachCell({ includeEmpty: false }, (c, colNumber) => {
        // merged cells repeat the master's value; keep only the master
        if (c.isMerged && c.master && c.master.address !== c.address) return;
        cells[colNumber] = plainCell(c.value);
      });
      rows[rowNumber] = cells;
    });
    try {
      const parsed = parseBomRows(rows);
      return { ...parsed, sheetName: sheet.name };
    } catch (err) {
      if (err.status !== 400) throw err;
      firstError = firstError || err;
    }
  }
  throw firstError || Object.assign(new Error("The workbook has no sheets."), { status: 400 });
}

module.exports = {
  parseBomRows,
  parseBomWorkbook,
  parseRateFormula,
  normLabel,
  plainCell,
};
