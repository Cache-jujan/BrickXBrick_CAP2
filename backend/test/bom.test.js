// Unit tests for the Bill of Materials importer (lib/bomImport.js) and rules
// (lib/bomRules.js). The workbook is built in memory with the same layout as
// the company's BOM but made-up items and figures. No client file is used.
const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");

const { parseBomWorkbook, parseBomRows, parseRateFormula } = require("../src/lib/bomImport");
const {
  bomTotals,
  sectionTotals,
  buildBomWarnings,
  validateBomPayload,
  approvalProblems,
} = require("../src/lib/bomRules");

// Builds a workbook laid out like the company's BOM:
// header block, column header row 10, sections, MATERIAL COST / LABOR COST
// rows with formulas, a section with labor in the prices, a total and a footer.
async function sampleWorkbook({ breakTotal = false } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BUILDING PERMIT");
  ws.getCell("A1").value = "PROJECT :";
  ws.getCell("B1").value = "Sample House"; // header block: must not be imported
  ws.getCell("A3").value = "OWNER :";
  ws.getCell("B3").value = "Sample Owner";
  ws.getCell("A7").value = "BILL OF MATERIALS AND COST ESTIMATE";
  ws.getRow(10).values = ["SCOPE ", "DESCRIPTION", "QUANTITY", "UNIT", "UNIT COST", "COST", "TOTAL"];

  let r = 12;
  const item = (desc, qty, unit, cost) => {
    ws.getRow(r).values = [null, desc, qty, unit, cost];
    ws.getCell(`F${r}`).value = { formula: `C${r}*E${r}`, result: qty * cost };
    r += 1;
  };
  const section = (name) => {
    ws.getCell(`A${r}`).value = name;
    r += 1;
  };
  const materialRow = (label, first, last, total) => {
    ws.getCell(`F${r}`).value = label;
    ws.getCell(`G${r}`).value = { formula: `SUM(F${first}:F${last})`, result: total };
    const row = r;
    r += 1;
    return row;
  };

  // 1. STRUCTURAL: labor = 50% of materials (formula)
  section("STRUCTURAL");
  let first = r;
  item("CEMENT", 100, "bags", 200); // 20,000
  item("DEFORMED BAR 12MM ", 50, "lengths", 250); // 12,500
  item("WELDING ROD SAMPLE", 1, "box", 2000); // 2,000
  let mat = materialRow("M ATERIAL COST", first, r - 1, 34500);
  ws.getCell(`F${r}`).value = "LABOR COST";
  ws.getCell(`G${r}`).value = { formula: `G${mat}*0.5`, result: 17250 };
  r += 2;

  // 2. PLUMBING with a sub-heading; labor typed as a fixed amount
  section("PLUMBING");
  section("ROUGHING-INS & FIXTURES");
  first = r;
  item('PVC ELBOW 2"', 10, "pcs.", 50); // 500
  item('PVC ELBOW 3"', 10, "pcs.", 60); // 600
  item('PVC ELBOW 4"X45', 5, "pcs.", 450); // 2,250, unusual
  item("CEMENT", 5, "bags", 200); // 1,000, same item as Structural, same unit
  materialRow("MATERIAL COST", first, r - 1, 4350);
  ws.getCell(`F${r}`).value = "LABOR COST";
  ws.getCell(`G${r}`).value = 3000;
  r += 2;

  // 3. GLASS: labor is included in the prices
  section("GLASS WALLS AND DOORS");
  r += 1; // empty row under the merged section name
  first = r;
  item("SLIDING WINDOW", 2, "unit", 5000); // 10,000
  materialRow("LABOR-MATERIAL COST", first, r - 1, 10000);
  r += 1;

  // 4. STEELWORKS: same welding rod in a different unit
  section("STEELWORKS");
  first = r;
  item("WELDING ROD SAMPLE", 10, "kg", 150); // 1,500
  mat = materialRow("TOTAL MATERIALS", first, r - 1, 1500);
  ws.getCell(`F${r}`).value = "LABOR COST";
  ws.getCell(`G${r}`).value = { formula: `G${mat}*0.7`, result: 1050 };
  r += 3;

  // materials 50,350 + labor 21,300 = 71,650
  ws.getCell(`D${r}`).value = "TOTAL PROJECT COST:";
  ws.getCell(`G${r}`).value = { formula: `SUM(G11:G${r - 1})`, result: breakTotal ? 70000 : 71650 };
  r += 1;
  ws.getCell(`A${r}`).value = "PREPARED BY:";
  ws.getCell(`A${r + 1}`).value = "ENGR. SAMPLE NAME";
  ws.getRow(r + 2).values = [null, "FOOTER ROW THAT LOOKS LIKE AN ITEM", 1, "pc", 1]; // after PREPARED BY: ignored
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("imports sections, items, labor modes and the stated total", async () => {
  const bom = await parseBomWorkbook(await sampleWorkbook());
  assert.equal(bom.sheetName, "BUILDING PERMIT");
  assert.deepEqual(
    bom.sections.map((s) => s.name),
    ["STRUCTURAL", "PLUMBING", "GLASS WALLS AND DOORS", "STEELWORKS"]
  );
  const [structural, plumbing, glass, steel] = bom.sections;
  assert.equal(structural.items.length, 3);
  assert.equal(structural.items[1].description, "DEFORMED BAR 12MM"); // trimmed, otherwise verbatim
  assert.equal(structural.items[0].unit, "bags");
  assert.equal(structural.laborRate, 0.5);
  assert.equal(structural.laborAmount, null);
  assert.equal(structural.statedMaterialTotal, 34500); // "M ATERIAL COST" with a space
  assert.equal(plumbing.subheading, "ROUGHING-INS & FIXTURES");
  assert.equal(plumbing.laborRate, null);
  assert.equal(plumbing.laborAmount, 3000);
  assert.equal(glass.laborIncludedInItems, true);
  assert.equal(glass.statedMaterialTotal, 10000);
  assert.equal(steel.laborRate, 0.7);
  assert.equal(bom.statedTotal, 71650);
  assert.deepEqual(bom.skippedRows, []);

  const totals = bomTotals(bom.sections);
  assert.deepEqual(totals, { materials: 50350, labor: 21300, total: 71650, itemCount: 9, sectionCount: 4 });
});

test("header block and footer are never imported", async () => {
  const bom = await parseBomWorkbook(await sampleWorkbook());
  const everything = JSON.stringify(bom);
  assert.ok(!everything.includes("Sample House"));
  assert.ok(!everything.includes("Sample Owner"));
  assert.ok(!everything.includes("SAMPLE NAME"));
  assert.ok(!everything.includes("FOOTER ROW"));
});

test("warnings: unusual price, different units, nothing else when it reconciles", async () => {
  const bom = await parseBomWorkbook(await sampleWorkbook());
  const warnings = buildBomWarnings(bom.sections, { statedTotal: bom.statedTotal });
  const codes = warnings.map((w) => w.code).sort();
  assert.deepEqual(codes, ["SAME_ITEM_DIFFERENT_UNITS", "UNUSUAL_UNIT_COST"]);
  assert.match(warnings.find((w) => w.code === "UNUSUAL_UNIT_COST").message, /PVC ELBOW 4"X45/);
  const units = warnings.find((w) => w.code === "SAME_ITEM_DIFFERENT_UNITS");
  assert.equal(units.level, "info");
  assert.match(units.message, /WELDING ROD SAMPLE/);
});

test("warnings: edited quantity and a wrong file total are reported against the file", async () => {
  const bom = await parseBomWorkbook(await sampleWorkbook({ breakTotal: true }));
  bom.sections[0].items[0].quantity = 110; // CEMENT 100 -> 110
  const codes = buildBomWarnings(bom.sections, { statedTotal: bom.statedTotal }).map((w) => w.code);
  assert.ok(codes.includes("SECTION_MATERIALS_MISMATCH"));
  assert.ok(codes.includes("SECTION_LABOR_MISMATCH")); // 50% labor moves with materials
  assert.ok(codes.includes("TOTAL_MISMATCH"));
});

test("rows with missing values are skipped and listed, not guessed", () => {
  const cell = (v, f = null) => ({ v, f });
  const rows = [];
  rows[1] = [null, cell("SCOPE"), cell("DESCRIPTION"), cell("QUANTITY"), cell("UNIT"), cell("UNIT COST"), cell("COST"), cell("TOTAL")];
  rows[2] = [null, cell("CARPENTRY")];
  rows[3] = [null, null, cell("PLYWOOD"), cell(4), cell("sheet"), cell(800)];
  rows[4] = [null, null, cell("NO UNIT ITEM"), cell(4), null, cell(800)];
  rows[5] = [null, null, cell("ZERO QTY"), cell(0), cell("pcs"), cell(10)];
  rows[6] = [null, null, cell("NO PRICE"), cell(3), cell("pcs")];
  const bom = parseBomRows(rows);
  assert.equal(bom.sections[0].items.length, 1);
  assert.deepEqual(bom.skippedRows.map((s) => s.row), [4, 5, 6]);
  assert.match(bom.skippedRows[0].reason, /no unit/);
  assert.match(bom.skippedRows[1].reason, /quantity/);
  assert.match(bom.skippedRows[2].reason, /no unit cost/);
});

test("a file without the BOM header row is rejected", () => {
  const rows = [];
  rows[1] = [null, { v: "Name" }, { v: "Amount" }];
  assert.throws(() => parseBomRows(rows), (err) => err.status === 400 && /doesn't look like a Bill of Materials/.test(err.message));
});

test("a non-Excel file is rejected with 400", async () => {
  await assert.rejects(parseBomWorkbook(Buffer.from("not a workbook")), (err) => err.status === 400);
});

test("labor formula parsing", () => {
  assert.deepEqual(parseRateFormula("=G35*0.5"), { col: 7, row: 35, rate: 0.5 });
  assert.deepEqual(parseRateFormula("0.75*$G$134"), { col: 7, row: 134, rate: 0.75 });
  assert.deepEqual(parseRateFormula("G10*70%"), { col: 7, row: 10, rate: 0.7 });
  assert.equal(parseRateFormula("SUM(G1:G5)"), null);
  assert.equal(parseRateFormula(null), null);
});

test("section totals for each labor mode", () => {
  const items = [{ quantity: 3, unitCost: 0.5 }, { quantity: 2, unitCost: 100 }]; // 201.50
  assert.deepEqual(sectionTotals({ items, laborRate: 0.5 }), { materials: 201.5, labor: 100.75, total: 302.25, laborMode: "rate" });
  assert.deepEqual(sectionTotals({ items, laborAmount: 99 }), { materials: 201.5, labor: 99, total: 300.5, laborMode: "amount" });
  assert.deepEqual(sectionTotals({ items, laborIncludedInItems: true }), { materials: 201.5, labor: 0, total: 201.5, laborMode: "included" });
  assert.deepEqual(sectionTotals({ items }), { materials: 201.5, labor: 0, total: 201.5, laborMode: "none" });
});

test("edit validation: normalizes a good payload", () => {
  const out = validateBomPayload({
    sections: [
      {
        name: "  CARPENTRY ",
        laborMode: "rate",
        laborRate: 0.75,
        items: [{ bomItemId: "abc", description: " PLYWOOD 1/2 ", quantity: "10", unit: "sheet", unitCost: 800 }],
      },
      { name: "GLASS", laborMode: "included", items: [] },
    ],
  });
  assert.equal(out[0].name, "CARPENTRY");
  assert.equal(out[0].laborRate, 0.75);
  assert.equal(out[0].items[0].description, "PLYWOOD 1/2");
  assert.equal(out[0].items[0].quantity, 10);
  assert.equal(out[0].items[0].bomItemId, "abc");
  assert.equal(out[1].laborIncludedInItems, true);
});

test("edit validation: lists every bad field", () => {
  assert.throws(
    () =>
      validateBomPayload({
        sections: [
          {
            name: "",
            laborMode: "rate",
            laborRate: -1,
            items: [{ description: "", quantity: 0, unit: "", unitCost: -5 }],
          },
        ],
      }),
    (err) => {
      assert.equal(err.status, 400);
      const fields = err.details.errors.map((e) => e.field);
      assert.deepEqual(fields, [
        "sections[0].name",
        "sections[0].laborRate",
        "sections[0].items[0].description",
        "sections[0].items[0].unit",
        "sections[0].items[0].quantity",
        "sections[0].items[0].unitCost",
      ]);
      return true;
    }
  );
  assert.throws(() => validateBomPayload({}), (err) => err.status === 400);
});

test("approval needs at least one item and a total above zero", () => {
  assert.deepEqual(approvalProblems([{ name: "A", items: [] }]), [
    "The BOM has no items.",
    "The BOM total must be more than ₱0.",
  ]);
  assert.deepEqual(approvalProblems([{ name: "A", items: [{ quantity: 1, unitCost: 5 }] }]), []);
});
