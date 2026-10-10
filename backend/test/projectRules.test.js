// Unit tests for the F2 project lifecycle and assignment rules
// (lib/projectRules.js). Pure functions are tested directly; the DB helpers
// get a fake client that records the SQL it was sent.
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateProjectDates,
  parseServiceArea,
  isWithinServiceArea,
  buildProjectWarnings,
  evaluateAvailability,
  assertStatusTransition,
  loadProjectSettings,
  assertManagerAvailable,
  DEFAULT_SETTINGS,
} = require("../src/lib/projectRules");

// --- dates ------------------------------------------------------------------

test("dates: development <= construction <= completion is valid", () => {
  assert.deepEqual(
    validateProjectDates({ startDate: "2027-01-04", constructionStartDate: "2027-02-01", endDate: "2027-06-30" }),
    []
  );
});

test("dates: all three may fall on the same day", () => {
  assert.deepEqual(
    validateProjectDates({ startDate: "2027-01-04", constructionStartDate: "2027-01-04", endDate: "2027-01-04" }),
    []
  );
});

test("dates: each date is required", () => {
  const errors = validateProjectDates({});
  assert.deepEqual(errors.map((e) => e.field), ["startDate", "constructionStartDate", "endDate"]);
});

test("dates: rejects a non-calendar date", () => {
  const errors = validateProjectDates({ startDate: "2027-02-30", constructionStartDate: "2027-03-01", endDate: "2027-04-01" });
  assert.equal(errors[0].field, "startDate");
});

test("dates: construction before development is rejected", () => {
  const errors = validateProjectDates({ startDate: "2027-03-01", constructionStartDate: "2027-02-01", endDate: "2027-06-30" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "constructionStartDate");
});

test("dates: completion before construction is rejected", () => {
  const errors = validateProjectDates({ startDate: "2027-01-01", constructionStartDate: "2027-03-01", endDate: "2027-02-01" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "endDate");
});

// --- service area -----------------------------------------------------------

test("service area: parsing trims, lowercases and drops blanks", () => {
  assert.deepEqual(parseServiceArea(" Consolacion , Liloan,, "), ["consolacion", "liloan"]);
});

test("service area: match ignores case and extra spaces", () => {
  const area = parseServiceArea("Consolacion");
  assert.equal(isWithinServiceArea("  CONSOLACION ", area), true);
  assert.equal(isWithinServiceArea("Mandaue City", area), false);
});

test("warnings: outside the service area produces a warning, inside does not", () => {
  const settings = { ...DEFAULT_SETTINGS, serviceAreaMunicipalities: ["consolacion"] };
  assert.deepEqual(buildProjectWarnings({ municipality: "Consolacion" }, settings), []);
  const warnings = buildProjectWarnings({ municipality: "Talisay City" }, settings);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, "OUTSIDE_SERVICE_AREA");
});

// --- availability -----------------------------------------------------------

test("availability: a PM with 0 open projects is available at limit 1", () => {
  assert.equal(evaluateAvailability([], 1).available, true);
});

test("availability: a PM with 1 open project is NOT available at limit 1 (client policy)", () => {
  const result = evaluateAvailability([{ projectid: "a" }], 1);
  assert.equal(result.available, false);
  assert.equal(result.openProjectCount, 1);
});

test("availability: an SM with 2 sites is available at limit 3, with 3 is not", () => {
  assert.equal(evaluateAvailability([{}, {}], 3).available, true);
  assert.equal(evaluateAvailability([{}, {}, {}], 3).available, false);
});

// --- status transitions ------------------------------------------------------

test("transitions: Draft -> Active and Active -> Completed are allowed", () => {
  assert.doesNotThrow(() => assertStatusTransition("Draft", "Active"));
  assert.doesNotThrow(() => assertStatusTransition("Active", "Completed"));
  assert.doesNotThrow(() => assertStatusTransition("Draft", "Cancelled"));
  assert.doesNotThrow(() => assertStatusTransition("Active", "Cancelled"));
});

test("transitions: Draft -> Completed and Completed -> Active are rejected with 409", () => {
  for (const [from, to] of [["Draft", "Completed"], ["Completed", "Active"], ["Cancelled", "Active"]]) {
    assert.throws(() => assertStatusTransition(from, to), (err) => err.status === 409);
  }
});

// --- settings ---------------------------------------------------------------

test("settings: rows override defaults; bad values fall back", async () => {
  const runQuery = async () => ({
    rows: [
      { key: "pm_max_open_projects", value: "2" },
      { key: "sm_max_open_projects", value: "zero" },
      { key: "service_area_municipalities", value: "Consolacion, Liloan" },
    ],
  });
  const settings = await loadProjectSettings(runQuery);
  assert.equal(settings.pmMaxOpenProjects, 2);
  assert.equal(settings.smMaxOpenProjects, DEFAULT_SETTINGS.smMaxOpenProjects);
  assert.deepEqual(settings.serviceAreaMunicipalities, ["consolacion", "liloan"]);
});

// --- assertManagerAvailable --------------------------------------------------

function fakeClient({ user, openProjects }) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      const sql = text.replace(/\s+/g, " ").trim();
      calls.push({ sql, params });
      if (sql.startsWith("SELECT userid, name, role, status FROM users")) {
        return user ? { rows: [user], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("SELECT projectid, name FROM projects")) {
        return { rows: openProjects, rowCount: openProjects.length };
      }
      throw new Error(`Unhandled query: ${sql}`);
    },
  };
}

const settings = { ...DEFAULT_SETTINGS, pmMaxOpenProjects: 1, smMaxOpenProjects: 3 };

test("assertManagerAvailable: locks the user row so concurrent assignments serialize", async () => {
  const client = fakeClient({
    user: { userid: "pm-1", name: "Pat", role: "Project Manager", status: "Active" },
    openProjects: [],
  });
  await assertManagerAvailable(client, { userId: "pm-1", role: "Project Manager", settings });
  assert.match(client.calls[0].sql, /FOR UPDATE$/);
});

test("assertManagerAvailable: a busy PM is rejected with 409 and the busy project is named", async () => {
  const client = fakeClient({
    user: { userid: "pm-1", name: "Pat", role: "Project Manager", status: "Active" },
    openProjects: [{ projectid: "p-1", name: "Mansion A" }],
  });
  await assert.rejects(
    assertManagerAvailable(client, { userId: "pm-1", role: "Project Manager", settings }),
    (err) => err.status === 409 && /Mansion A/.test(err.message) && /limit for a Project Manager is 1/.test(err.message)
  );
});

test("assertManagerAvailable: the project being edited is excluded from the count", async () => {
  const client = fakeClient({
    user: { userid: "pm-1", name: "Pat", role: "Project Manager", status: "Active" },
    openProjects: [],
  });
  await assertManagerAvailable(client, { userId: "pm-1", role: "Project Manager", excludeProjectId: "p-1", settings });
  const countCall = client.calls[1];
  assert.equal(countCall.params[2], "p-1");
});

test("assertManagerAvailable: wrong role and deactivated accounts are 400", async () => {
  const wrongRole = fakeClient({ user: { userid: "u", name: "X", role: "Site Manager", status: "Active" }, openProjects: [] });
  await assert.rejects(
    assertManagerAvailable(wrongRole, { userId: "u", role: "Project Manager", settings }),
    (err) => err.status === 400
  );
  const inactive = fakeClient({ user: { userid: "u", name: "X", role: "Project Manager", status: "Inactive" }, openProjects: [] });
  await assert.rejects(
    assertManagerAvailable(inactive, { userId: "u", role: "Project Manager", settings }),
    (err) => err.status === 400
  );
  const missing = fakeClient({ user: null, openProjects: [] });
  await assert.rejects(
    assertManagerAvailable(missing, { userId: "u", role: "Project Manager", settings }),
    (err) => err.status === 400
  );
});

test("assertManagerAvailable: an SM with 2 open sites can take a third", async () => {
  const client = fakeClient({
    user: { userid: "sm-1", name: "Sam", role: "Site Manager", status: "Active" },
    openProjects: [{ projectid: "a", name: "A" }, { projectid: "b", name: "B" }],
  });
  await assertManagerAvailable(client, { userId: "sm-1", role: "Site Manager", settings });
});
