// F2: Bill of Materials totals, review warnings and edit validation.
// Pure functions (no database) so they can be unit tested.
//
// Labor follows the spreadsheet: per section, either a rate of the section's
// material cost (=G35*0.5), a fixed amount (11,700), included in the item
// prices (Glass Walls and Doors: "LABOR-MATERIAL COST"), or none.

const LABOR_MODES = ["rate", "amount", "included", "none"];

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function laborModeOf(section) {
  if (section.laborIncludedInItems) return "included";
  if (num(section.laborRate) !== null) return "rate";
  if (num(section.laborAmount) !== null) return "amount";
  return "none";
}

function sectionTotals(section) {
  const materials = round2(
    (section.items || []).reduce((sum, it) => sum + round2(num(it.quantity) * num(it.unitCost)), 0)
  );
  const mode = laborModeOf(section);
  let labor = 0;
  if (mode === "rate") labor = round2(materials * num(section.laborRate));
  else if (mode === "amount") labor = round2(num(section.laborAmount));
  return { materials, labor, total: round2(materials + labor), laborMode: mode };
}

function bomTotals(sections) {
  let materials = 0;
  let labor = 0;
  let itemCount = 0;
  for (const s of sections) {
    const t = sectionTotals(s);
    materials += t.materials;
    labor += t.labor;
    itemCount += (s.items || []).length;
  }
  materials = round2(materials);
  labor = round2(labor);
  return { materials, labor, total: round2(materials + labor), itemCount, sectionCount: sections.length };
}

// ₱541,975 or ₱270,987.50 (centavos only when there are any)
const peso = (n) => {
  const v = Number(n);
  const d = Number.isInteger(round2(v)) ? 0 : 2;
  return `₱${v.toLocaleString("en-PH", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};

function differs(a, b) {
  return a !== null && b !== null && Math.abs(num(a) - num(b)) > 0.005;
}

// "PVC ELBOW 2"X45" -> "PVC ELBOW"
function familyKey(description) {
  const words = String(description).toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter((w) => w.length > 1);
  return words.slice(0, 2).join(" ");
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Review warnings. Nothing here blocks saving; the GM confirms them on approve.
 * level "warning": a figure doesn't match the signed file, or looks unusual.
 * level "info":    worth knowing, not a problem (e.g. the same material in two
 *                  sections with different units; they're tracked separately).
 */
function buildBomWarnings(sections, { statedTotal = null } = {}) {
  const warnings = [];

  sections.forEach((s, si) => {
    const t = sectionTotals(s);
    const label = s.name || `Section ${si + 1}`;
    if (!s.items || s.items.length === 0) {
      warnings.push({ level: "warning", code: "EMPTY_SECTION", section: si, message: `${label} has no items.` });
    }
    if (differs(t.materials, num(s.statedMaterialTotal))) {
      warnings.push({
        level: "warning",
        code: "SECTION_MATERIALS_MISMATCH",
        section: si,
        message: `${label}: materials add up to ${peso(t.materials)}, but the file says ${peso(s.statedMaterialTotal)}.`,
      });
    }
    if (t.laborMode !== "included" && differs(t.labor, num(s.statedLaborAmount))) {
      warnings.push({
        level: "warning",
        code: "SECTION_LABOR_MISMATCH",
        section: si,
        message: `${label}: labor is ${peso(t.labor)}, but the file says ${peso(s.statedLaborAmount)}.`,
      });
    }
  });

  const totals = bomTotals(sections);
  if (differs(totals.total, num(statedTotal))) {
    warnings.push({
      level: "warning",
      code: "TOTAL_MISMATCH",
      message: `The BOM adds up to ${peso(totals.total)}, but the file's total project cost is ${peso(statedTotal)}.`,
    });
  }

  // Unit costs far from similar items (e.g. one elbow at ₱453 where the others are ₱45–₱65).
  const families = new Map();
  sections.forEach((s, si) =>
    (s.items || []).forEach((it, ii) => {
      const key = familyKey(it.description);
      if (!key.includes(" ")) return; // needs two words to compare like with like
      if (!families.has(key)) families.set(key, []);
      families.get(key).push({ si, ii, it });
    })
  );
  for (const members of families.values()) {
    if (members.length < 3) continue;
    for (const m of members) {
      const others = members.filter((o) => o !== m).map((o) => num(o.it.unitCost)).filter((v) => v > 0);
      if (others.length < 2) continue;
      const med = median(others);
      const cost = num(m.it.unitCost);
      if (med > 0 && cost >= med * 5) {
        warnings.push({
          level: "warning",
          code: "UNUSUAL_UNIT_COST",
          section: m.si,
          item: m.ii,
          message: `${m.it.description} (${sections[m.si].name}) costs ${peso(cost)} per ${m.it.unit}; similar items cost about ${peso(med)}.`,
        });
      }
    }
  }

  // Same description in several sections with different units: tracked separately.
  const byDescription = new Map();
  sections.forEach((s, si) =>
    (s.items || []).forEach((it) => {
      const key = String(it.description).toUpperCase().replace(/\s+/g, " ").trim();
      if (!byDescription.has(key)) byDescription.set(key, []);
      byDescription.get(key).push({ section: s.name, unit: String(it.unit).trim(), si });
    })
  );
  for (const [desc, uses] of byDescription) {
    const units = new Set(uses.map((u) => u.unit.toLowerCase().replace(/[.\s]/g, "")));
    if (uses.length > 1 && units.size > 1) {
      warnings.push({
        level: "info",
        code: "SAME_ITEM_DIFFERENT_UNITS",
        message: `${desc} appears as ${uses.map((u) => `${u.unit} (${u.section})`).join(" and ")}. They are tracked separately.`,
      });
    }
  }

  return warnings;
}

function fieldError(errors, path, message) {
  errors.push({ field: path, message });
}

/**
 * Validates the GM's edited BOM (PUT). Returns normalized sections:
 * [{ sectionId|null, name, subheading, laborRate, laborAmount,
 *    laborIncludedInItems, items: [{ bomItemId|null, description, quantity, unit, unitCost }] }]
 * Throws 400 with a list of field errors.
 */
function validateBomPayload(body) {
  const errors = [];
  const sections = Array.isArray(body?.sections) ? body.sections : null;
  if (!sections) {
    const err = new Error("sections must be a list");
    err.status = 400;
    throw err;
  }
  if (sections.length > 100) fieldError(errors, "sections", "A BOM can have at most 100 sections");

  let itemCount = 0;
  const out = sections.map((s, si) => {
    const p = `sections[${si}]`;
    const name = typeof s?.name === "string" ? s.name.replace(/\s+/g, " ").trim() : "";
    if (!name) fieldError(errors, `${p}.name`, "Section name is required");
    if (name.length > 150) fieldError(errors, `${p}.name`, "Section name is too long (150 max)");
    const subheading = typeof s?.subheading === "string" && s.subheading.trim() ? s.subheading.trim().slice(0, 200) : null;

    const mode = s?.laborMode ?? "none";
    if (!LABOR_MODES.includes(mode)) fieldError(errors, `${p}.laborMode`, `Labor must be one of: ${LABOR_MODES.join(", ")}`);
    let laborRate = null;
    let laborAmount = null;
    if (mode === "rate") {
      laborRate = num(s.laborRate);
      if (laborRate === null || laborRate < 0 || laborRate > 10) {
        fieldError(errors, `${p}.laborRate`, "Labor rate must be between 0 and 10 (e.g. 0.5 for 50%)");
      }
    } else if (mode === "amount") {
      laborAmount = num(s.laborAmount);
      if (laborAmount === null || laborAmount < 0) fieldError(errors, `${p}.laborAmount`, "Labor amount must be 0 or more");
    }

    const items = Array.isArray(s?.items) ? s.items : [];
    itemCount += items.length;
    const normItems = items.map((it, ii) => {
      const ip = `${p}.items[${ii}]`;
      const description = typeof it?.description === "string" ? it.description.replace(/\s+/g, " ").trim() : "";
      const unit = typeof it?.unit === "string" ? it.unit.trim() : "";
      const quantity = num(it?.quantity);
      const unitCost = num(it?.unitCost);
      if (!description) fieldError(errors, `${ip}.description`, "Description is required");
      if (description.length > 200) fieldError(errors, `${ip}.description`, "Description is too long (200 max)");
      if (!unit) fieldError(errors, `${ip}.unit`, "Unit is required");
      if (unit.length > 30) fieldError(errors, `${ip}.unit`, "Unit is too long (30 max)");
      if (quantity === null || quantity <= 0) fieldError(errors, `${ip}.quantity`, "Quantity must be more than 0");
      if (quantity !== null && quantity >= 1e10) fieldError(errors, `${ip}.quantity`, "Quantity is too large");
      if (unitCost === null || unitCost < 0) fieldError(errors, `${ip}.unitCost`, "Unit cost must be 0 or more");
      if (unitCost !== null && unitCost >= 1e10) fieldError(errors, `${ip}.unitCost`, "Unit cost is too large");
      return {
        bomItemId: typeof it?.bomItemId === "string" ? it.bomItemId : null,
        description,
        unit,
        quantity: quantity === null ? null : round2(quantity),
        unitCost: unitCost === null ? null : round2(unitCost),
      };
    });

    return {
      sectionId: typeof s?.sectionId === "string" ? s.sectionId : null,
      name,
      subheading,
      laborRate,
      laborAmount: laborAmount === null ? null : round2(laborAmount),
      laborIncludedInItems: mode === "included",
      items: normItems,
    };
  });
  if (itemCount > 2000) fieldError(errors, "sections", "A BOM can have at most 2000 items");

  if (errors.length) {
    const err = new Error(errors.length === 1 ? errors[0].message : `${errors.length} fields need fixing`);
    err.status = 400;
    err.details = { errors };
    throw err;
  }
  return out;
}

/** What must be true before the GM can approve. Returns a list of problems. */
function approvalProblems(sections) {
  const problems = [];
  const totals = bomTotals(sections);
  if (totals.itemCount === 0) problems.push("The BOM has no items.");
  if (totals.total <= 0) problems.push("The BOM total must be more than ₱0.");
  return problems;
}

module.exports = {
  LABOR_MODES,
  round2,
  laborModeOf,
  sectionTotals,
  bomTotals,
  buildBomWarnings,
  validateBomPayload,
  approvalProblems,
  familyKey,
};
