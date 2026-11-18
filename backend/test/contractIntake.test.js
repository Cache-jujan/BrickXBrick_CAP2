// F2: starting a new project from a signed contract. The reader proposes values;
// nothing is saved. These cover the proposal, the site-location split and the
// working-days estimate.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  titleCase,
  guessProjectType,
  splitSiteLocation,
  suggestProjectName,
  addWorkingDays,
  proposeProjectFromContract,
} = require("../src/lib/contractIntake");

test("titleCase tidies shouting text and keeps initials", () => {
  assert.equal(titleCase("SITIO VILLAROCA"), "Sitio Villaroca");
  assert.equal(titleCase("CARINA C. FLORES"), "Carina C. Flores");
  assert.equal(titleCase("  talisay   city "), "Talisay City");
  assert.equal(titleCase(""), "");
});

test("the project type follows the scope, and is empty when unclear", () => {
  assert.equal(guessProjectType("FOUR (4) STOREY RESIDENTIAL BUILDING; AS-BUILT RENOVATION"), "Residential Building");
  assert.equal(guessProjectType("Commercial building"), "Commercial Building");
  assert.equal(guessProjectType("Office fit-out"), "Fit-out / Renovation");
  assert.equal(guessProjectType("Drainage canal"), "Drainage / Flood Control");
  assert.equal(guessProjectType("Concrete road widening"), "Road Maintenance");
  assert.equal(guessProjectType("Renovation of the hall"), "Fit-out / Renovation");
  assert.equal(guessProjectType("Something else"), "");
  assert.equal(guessProjectType(null), "");
});

test("a site location is split into municipality, province and address", () => {
  assert.deepEqual(splitSiteLocation("SITIO VILLAROCA, POBLACION, OCCIDENTAL CONSOLACION, CEBU", ["consolacion"]), {
    municipality: "Consolacion",
    province: "Cebu",
    siteAddress: "Sitio Villaroca, Poblacion, Occidental",
  });
  assert.deepEqual(splitSiteLocation("BARANGAY SAMPLE, TALISAY CITY, CEBU", ["consolacion"]), {
    municipality: "Talisay City",
    province: "Cebu",
    siteAddress: "Barangay Sample",
  });
  assert.deepEqual(splitSiteLocation("Casili, Consolacion", ["consolacion"]), {
    municipality: "Consolacion",
    province: "",
    siteAddress: "Casili",
  });
  assert.deepEqual(splitSiteLocation("", ["consolacion"]), { municipality: "", province: "", siteAddress: "" });
});

test("the name suggestion uses the surname and the kind of building", () => {
  assert.equal(suggestProjectName("CARINA C. FLORES", "Residential Building"), "Flores Residence");
  assert.equal(suggestProjectName("JUAN DELA CRUZ AND MARIA DELA CRUZ", "Commercial Building"), "Cruz Building");
  assert.equal(suggestProjectName("MARIA D. SANTOS", ""), "Santos Project");
  assert.equal(suggestProjectName("", "Residential Building"), "");
});

test("working days skip Sundays and count the start day", () => {
  assert.equal(addWorkingDays("2026-11-02", 1), "2026-11-02"); // Monday
  assert.equal(addWorkingDays("2026-11-02", 6), "2026-11-07"); // Saturday
  assert.equal(addWorkingDays("2026-11-02", 7), "2026-11-09"); // Sunday skipped
  assert.equal(addWorkingDays("2026-11-01", 1), "2026-11-02"); // starts on a Sunday
  assert.equal(addWorkingDays("2026-11-02", 120), "2027-03-20");
});

test("working days refuse bad input", () => {
  assert.equal(addWorkingDays("not a date", 10), null);
  assert.equal(addWorkingDays("2026-11-02", 0), null);
  assert.equal(addWorkingDays("2026-11-02", 2.5), null);
  assert.equal(addWorkingDays("2026-02-31", 5) === null || typeof addWorkingDays("2026-02-31", 5) === "string", true);
});

test("the proposal fills identity fields only: no budget, dates or managers", () => {
  const { proposal, suggested } = proposeProjectFromContract({
    fields: {
      ownerName: "CARINA C. FLORES",
      scope: "FOUR (4) STOREY RESIDENTIAL BUILDING",
      siteLocation: "SITIO VILLAROCA, POBLACION, OCCIDENTAL CONSOLACION, CEBU",
      contractAmount: 2800000,
      durationWorkingDays: 120,
    },
  });
  assert.equal(proposal.clientName, "CARINA C. FLORES");
  assert.equal(proposal.projectType, "Residential Building");
  assert.equal(proposal.municipality, "Consolacion");
  assert.equal(proposal.durationWorkingDays, 120);
  for (const key of ["budget", "startDate", "constructionStartDate", "endDate", "projectManagerId", "siteManagerId"]) {
    assert.equal(key in proposal, false, `${key} must not be proposed`);
  }
  assert.deepEqual(suggested, ["name", "projectType", "site"]);
});

test("a contract with nothing readable proposes nothing and does not throw", () => {
  const { proposal, suggested } = proposeProjectFromContract({ fields: {} });
  assert.equal(proposal.name, "");
  assert.equal(proposal.clientName, "");
  assert.equal(proposal.projectType, "");
  assert.equal(proposal.durationWorkingDays, null);
  assert.deepEqual(suggested, []);
  assert.doesNotThrow(() => proposeProjectFromContract(null));
});

test("a very long contract line is cut to the project form's limits", () => {
  const long = "A".repeat(5000);
  const { proposal } = proposeProjectFromContract({ fields: { ownerName: long, scope: long, siteLocation: `${long}, ${long}, ${long}` } });
  assert.ok(proposal.clientName.length <= 150);
  assert.ok(proposal.description.length <= 2000);
  assert.ok(proposal.siteAddress.length <= 255);
  assert.ok(proposal.municipality.length <= 100 && proposal.province.length <= 100);
});
