// F2: starting a project from a template or a past project (projectStructure.js).
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  addDays,
  daysBetween,
  anchorFor,
  parseStartRequest,
  buildStructure,
  insertStructure,
} = require("../src/lib/projectStructure");

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DATES = { startDate: "2027-01-04", constructionStartDate: "2027-03-01", endDate: "2027-07-30" };

function source() {
  return {
    kind: "template",
    id: ID(900),
    name: "Test template",
    milestones: [
      {
        id: ID(1), name: "Permits", phase: "Planning", offset: 20,
        tasks: [
          { id: ID(11), name: "Scope", handledBy: "GM", requirementCode: null, offset: 5, defaultIncluded: true, selectable: false },
          { id: ID(12), name: "Electrical permit", handledBy: "PM", requirementCode: "BP-ELEC", offset: 10, defaultIncluded: true, selectable: true },
          { id: ID(13), name: "Fence permit", handledBy: "PM", requirementCode: "COND-FENCE", offset: 12, defaultIncluded: false, selectable: true },
        ],
      },
      {
        id: ID(2), name: "Foundation", phase: "Construction", offset: 30,
        tasks: [{ id: ID(21), name: "Excavate", handledBy: null, requirementCode: null, offset: 15, defaultIncluded: true, selectable: false }],
      },
    ],
  };
}
const req = (extra = {}) => ({ mode: "template", templateId: ID(900), includeTaskIds: new Set(), excludeTaskIds: new Set(), ...extra });

test("date helpers work on calendar days and ignore the server's time zone", () => {
  assert.equal(addDays("2027-01-04", 21), "2027-01-25");
  assert.equal(addDays("2027-12-20", 20), "2028-01-09");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(daysBetween("2027-01-04", "2027-01-25"), 21);
  assert.equal(daysBetween("2027-01-25", "2027-01-04"), -21);
});

test("Planning counts from development, Construction from construction start", () => {
  const p = { startDate: "2027-01-04", constructionStartDate: "2027-03-01" };
  assert.equal(anchorFor("Planning", p), "2027-01-04");
  assert.equal(anchorFor("Construction", p), "2027-03-01");
  assert.equal(anchorFor("Construction", { startDate: "2027-01-04" }), "2027-01-04");
});

test("a missing start means a blank sheet; bad input is rejected", () => {
  assert.deepEqual(parseStartRequest(undefined), { mode: "blank" });
  assert.deepEqual(parseStartRequest({ mode: "blank" }), { mode: "blank" });
  assert.throws(() => parseStartRequest("template"), /object/);
  assert.throws(() => parseStartRequest({ mode: "wild" }), /mode/);
  assert.throws(() => parseStartRequest({ mode: "template" }), /template/);
  assert.throws(() => parseStartRequest({ mode: "template", templateId: "nope" }), /template/);
  assert.throws(() => parseStartRequest({ mode: "copy", sourceProjectId: "nope" }), /copy/);
  assert.throws(() => parseStartRequest({ mode: "template", templateId: ID(1), excludeTaskIds: ["x"] }), /list of ids/);
  const ok = parseStartRequest({ mode: "template", templateId: ID(1), excludeTaskIds: [ID(2), ID(2)] });
  assert.equal(ok.excludeTaskIds.size, 1);
});

test("template build: dates, owners, order and default selection", () => {
  const out = buildStructure(source(), req(), DATES);
  assert.deepEqual(out.counts, { milestones: 2, tasks: 3 });
  const [permits, foundation] = out.milestones;
  assert.equal(permits.dueDate, "2027-01-24");
  assert.equal(foundation.dueDate, "2027-03-31"); // 2027-03-01 + 30
  assert.deepEqual(permits.tasks.map((t) => [t.name, t.handledBy, t.dueDate, t.sortOrder]), [
    ["Scope", "GM", "2027-01-09", 1],
    ["Electrical permit", "PM", "2027-01-14", 2],
  ]);
  assert.equal(foundation.tasks[0].handledBy, null);
  assert.equal(foundation.sortOrder, 2);
  assert.equal(out.needsSiteManager, true);
  assert.deepEqual(out.warnings, []);
});

test("the GM can untick a document and tick an optional one", () => {
  const out = buildStructure(source(), req({ excludeTaskIds: new Set([ID(12)]), includeTaskIds: new Set([ID(13)]) }), DATES);
  assert.deepEqual(out.milestones[0].tasks.map((t) => t.name), ["Scope", "Fence permit"]);
});

test("only permit documents can be unticked in a template", () => {
  assert.throws(() => buildStructure(source(), req({ excludeTaskIds: new Set([ID(11)]) }), DATES), /can't be removed/);
  assert.throws(() => buildStructure(source(), req({ excludeTaskIds: new Set([ID(777)]) }), DATES), /isn't part of/);
  assert.throws(() => buildStructure(source(), req({ includeTaskIds: new Set([ID(777)]) }), DATES), /isn't part of/);
});

test("a milestone left with no tasks is dropped and reported", () => {
  const s = source();
  s.milestones[0].tasks = [s.milestones[0].tasks[1]];
  const out = buildStructure(s, req({ excludeTaskIds: new Set([ID(12)]) }), DATES);
  assert.deepEqual(out.omittedMilestones, ["Permits"]);
  assert.equal(out.milestones.length, 1);
  assert.equal(out.milestones[0].sortOrder, 1);
});

test("no construction tasks means no Site Manager is needed", () => {
  const s = source();
  s.milestones = [s.milestones[0]];
  assert.equal(buildStructure(s, req(), DATES).needsSiteManager, false);
});

test("dates outside the project window are kept and warned about", () => {
  const tight = { startDate: "2027-01-04", constructionStartDate: "2027-01-10", endDate: "2027-02-01" };
  const out = buildStructure(source(), req(), tight);
  assert.ok(out.warnings.length > 0);
  assert.ok(out.milestones[0].warning); // Permits due Jan 24 is after construction starts
  assert.equal(out.milestones[0].dueDate, "2027-01-24");
});

test("copy mode lets the GM untick any task", () => {
  const s = source();
  s.kind = "copy";
  for (const m of s.milestones) for (const t of m.tasks) { t.selectable = true; t.defaultIncluded = true; }
  const out = buildStructure(s, { mode: "copy", sourceProjectId: ID(900), excludeTaskIds: new Set([ID(11), ID(21)]) }, DATES);
  assert.deepEqual(out.milestones.map((m) => m.name), ["Permits"]);
  assert.deepEqual(out.omittedMilestones, ["Foundation"]);
});

test("blank sheet builds nothing", () => {
  const out = buildStructure(null, { mode: "blank" }, DATES);
  assert.deepEqual(out.counts, { milestones: 0, tasks: 0 });
  assert.equal(out.needsSiteManager, false);
});

function fakeClient() {
  const calls = [];
  let n = 0;
  return {
    calls,
    query: async (text, params) => {
      const sql = text.replace(/\s+/g, " ").trim();
      calls.push({ sql, params });
      if (sql.startsWith("INSERT INTO milestones")) return { rows: [{ milestoneid: `m${++n}` }], rowCount: 1 };
      if (sql.startsWith("INSERT INTO tasks")) return { rows: [], rowCount: 1 };
      throw new Error(`Unhandled query in fake client: ${sql}`);
    },
  };
}

test("insert: Planning tasks get a role owner, Construction tasks the Site Manager", async () => {
  const client = fakeClient();
  const structure = buildStructure(source(), req(), DATES);
  await insertStructure(client, { projectId: "p1", createdBy: "pm1", siteManagerId: "sm1", structure });

  const tasks = client.calls.filter((c) => c.sql.startsWith("INSERT INTO tasks"));
  assert.equal(tasks.length, 3);
  // [milestoneId, assignedTo, handledBy, taskName, dueDate, sortOrder, requirementCode]
  assert.deepEqual(tasks[0].params.slice(1, 4), [null, "GM", "Scope"]);
  assert.deepEqual(tasks[1].params.slice(1, 4), [null, "PM", "Electrical permit"]);
  assert.deepEqual(tasks[2].params.slice(1, 4), ["sm1", null, "Excavate"]);
  assert.equal(tasks[1].params[6], "BP-ELEC");

  const milestones = client.calls.filter((c) => c.sql.startsWith("INSERT INTO milestones"));
  assert.equal(milestones[0].params[1], "pm1"); // createdBy is the Project Manager
  assert.ok(!client.calls.some((c) => /notifications/i.test(c.sql)), "no per-task notifications");
});

test("insert: refuses Construction tasks when there is no Site Manager", async () => {
  const structure = buildStructure(source(), req(), DATES);
  await assert.rejects(
    insertStructure(fakeClient(), { projectId: "p1", createdBy: "pm1", siteManagerId: null, structure }),
    /Site Manager/
  );
});

test("nothing that belongs to a running project is written", async () => {
  const client = fakeClient();
  await insertStructure(client, { projectId: "p1", createdBy: "pm1", siteManagerId: "sm1", structure: buildStructure(source(), req(), DATES) });
  const text = client.calls.map((c) => c.sql).join("\n");
  for (const forbidden of ["task_progress_log", "task_documents", "photoEvidenceURL", "completionPercentage", "boms", "bom_items", "tickets", "expenses"]) {
    assert.ok(!text.includes(forbidden), `must not touch ${forbidden}`);
  }
});
