// contractIntake.js: turn what the contract reader found (lib/contractExtract.js)
// into PROPOSED values for the New Project form. Nothing here saves anything:
// the General Manager reviews and edits every value.
//
// The contract fills the project's identity (client, site, scope). The budget is
// NOT taken from the contract amount: it is still set from the approved BOM
// (see routes/bom.js). The planning and construction dates and the Project and
// Site Managers are never in a contract, so they stay for the GM to enter.

const { PROJECT_TYPES } = require("./projectRules");
const { LIMITS } = require("./inputRules");

const SMALL_WORDS = new Set(["of", "the", "and", "for", "at", "in", "de", "del", "dela", "la", "las", "los", "y"]);

/** "SITIO VILLAROCA" -> "Sitio Villaroca". Keeps short all-caps initials like "C." as they are. */
function titleCase(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      if (/^[A-Za-z]\.?$/.test(word)) return word.toUpperCase();
      return lower.replace(/(^|[-(/])([a-zñ])/g, (_m, pre, ch) => pre + ch.toUpperCase());
    })
    .join(" ");
}

/** Which project type the scope of work points to. Only a suggestion; "" when unclear. */
function guessProjectType(scope) {
  const s = String(scope || "").toUpperCase();
  if (!s) return "";
  if (/\bDRAINAGE\b|\bFLOOD\b/.test(s)) return "Drainage / Flood Control";
  if (/\bROAD\b|\bPAVEMENT\b/.test(s)) return "Road Maintenance";
  if (/\bRETROFIT/.test(s)) return "Structural Retrofitting";
  if (/\bFIT[- ]?OUT\b|\bINTERIOR\b/.test(s)) return "Fit-out / Renovation";
  if (/\bRESIDENTIAL\b|\bRESIDENCE\b|\bHOUSE\b|\bDWELLING\b|\bTOWNHOUSE\b/.test(s)) return "Residential Building";
  if (/\bCOMMERCIAL\b|\bOFFICE\b|\bSTORE\b|\bWAREHOUSE\b|\bMALL\b/.test(s)) return "Commercial Building";
  if (/\bRENOVATION\b|\bREMODEL/.test(s)) return "Fit-out / Renovation";
  return "";
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split a one-line site location such as
 * "SITIO VILLAROCA, POBLACION, OCCIDENTAL CONSOLACION, CEBU" into the form's
 * municipality, province and street/barangay. A municipality from the service
 * area is recognised inside the text (so "OCCIDENTAL CONSOLACION" becomes
 * Consolacion, with "Occidental" kept in the address). Without one, the
 * second-last part is used.
 */
function splitSiteLocation(siteLocation, serviceArea = []) {
  const raw = String(siteLocation || "").replace(/\s+/g, " ").trim();
  if (!raw) return { municipality: "", province: "", siteAddress: "" };

  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  let province = "";
  if (parts.length >= 3) province = titleCase(parts.pop());

  let municipality = "";
  let remainder = "";
  const areaHit = (serviceArea || [])
    .map((name) => String(name || "").trim())
    .filter(Boolean)
    .map((name) => ({ name, index: parts.findIndex((p) => new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(p)) }))
    .find((hit) => hit.index !== -1);

  if (areaHit) {
    municipality = titleCase(areaHit.name);
    remainder = titleCase(parts[areaHit.index].replace(new RegExp(`\\b${escapeRegExp(areaHit.name)}\\b`, "i"), "").replace(/\s+/g, " ").trim());
    const before = parts.slice(0, areaHit.index).map(titleCase);
    const after = parts.slice(areaHit.index + 1).map(titleCase);
    return {
      municipality,
      province,
      siteAddress: [...before, remainder, ...after].filter(Boolean).join(", "),
    };
  }

  if (parts.length >= 2) {
    municipality = titleCase(parts.pop());
  } else if (parts.length === 1 && province) {
    municipality = titleCase(parts.pop());
  }
  return { municipality, province, siteAddress: parts.map(titleCase).join(", ") };
}

/** "CARINA C. FLORES" + "FOUR (4) STOREY RESIDENTIAL BUILDING" -> "Flores Residence". Only a suggestion. */
function suggestProjectName(ownerName, projectType) {
  const first = String(ownerName || "").split(/\s+(?:AND|&)\s+/i)[0];
  const words = first.replace(/[^\p{L}\s.'-]/gu, " ").split(/\s+/).filter((w) => w.replace(/[.]/g, "").length > 1);
  const surname = words.length ? titleCase(words[words.length - 1]) : "";
  if (!surname) return "";
  const noun = projectType === "Residential Building" ? "Residence" : projectType === "Commercial Building" ? "Building" : "Project";
  return `${surname} ${noun}`;
}

/**
 * Working days from `startIso` (YYYY-MM-DD): the start day counts as day 1 when it
 * is not a Sunday, and Sundays are skipped. Holidays are not in the system, so
 * the result is an estimate and the form says so.
 */
function addWorkingDays(startIso, workingDays) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(startIso || ""));
  const n = Number(workingDays);
  if (!m || !Number.isInteger(n) || n < 1) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  let counted = 0;
  for (;;) {
    if (d.getUTCDay() !== 0) {
      counted += 1;
      if (counted === n) break;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * result = extractContract(...) output { fields, flags, found }.
 * Returns the proposal for the form. Every key is "" when the contract didn't
 * give it. `suggested` lists the keys that are guesses, not read from the text.
 */
function proposeProjectFromContract(result, { serviceArea = ["consolacion"] } = {}) {
  const f = (result && result.fields) || {};
  const projectType = guessProjectType(f.scope);
  const site = splitSiteLocation(f.siteLocation, serviceArea);
  const name = suggestProjectName(f.ownerName, projectType);

  // A proposal never goes over the project form's own limits, so a long contract line
  // can't make the create call fail after the GM has reviewed it.
  const cap = (value, max) => String(value || "").slice(0, max).trim();
  const proposal = {
    name: cap(name, LIMITS.projectName),
    clientName: cap(f.ownerName ? String(f.ownerName).replace(/\s+/g, " ").trim() : "", LIMITS.clientName),
    description: cap(f.scope ? titleCase(String(f.scope)) : "", LIMITS.description),
    projectType: PROJECT_TYPES.includes(projectType) ? projectType : "",
    municipality: cap(site.municipality, LIMITS.municipality),
    province: cap(site.province, LIMITS.province),
    siteAddress: cap(site.siteAddress, LIMITS.siteAddress),
    durationWorkingDays: Number.isInteger(f.durationWorkingDays) ? f.durationWorkingDays : null,
  };
  const suggested = [];
  if (proposal.name) suggested.push("name");
  if (proposal.projectType) suggested.push("projectType");
  if (proposal.municipality || proposal.siteAddress) suggested.push("site");
  return { proposal, suggested };
}

module.exports = { titleCase, guessProjectType, splitSiteLocation, suggestProjectName, addWorkingDays, proposeProjectFromContract };
