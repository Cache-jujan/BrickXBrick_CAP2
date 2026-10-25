import test from "node:test";
import assert from "node:assert/strict";

import { filterByProject, groupByProject, outOfScopeTicketIDs, tickState } from "../../project-groups.js";

const row = (id, projectID, projectName, createdAt, amount) => ({ id, projectID, projectName, createdAt, amount });
const pick = (r) => ({ id: r.projectID, name: r.projectName, amount: r.amount, at: r.createdAt });

test("rows are grouped per project with a count and a total", () => {
  const groups = groupByProject(
    [row("a", "p1", "Building", "2026-10-10T01:00:00Z", 100), row("b", "p2", "Annex", "2026-10-11T01:00:00Z", 50), row("c", "p1", "Building", "2026-10-10T01:05:00Z", 25)],
    pick
  );
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => [g.projectId, g.count, g.total]), [["p1", 2, 125], ["p2", 1, 50]]);
});

test("the project with the oldest item comes first, matching the oldest-first split", () => {
  const groups = groupByProject(
    [row("a", "p2", "Annex", "2026-10-11T01:00:00Z", 1), row("b", "p1", "Building", "2026-10-10T01:00:00Z", 1)],
    pick
  );
  assert.deepEqual(groups.map((g) => g.projectId), ["p1", "p2"]);
});

test("a missing or bad amount counts as zero and does not break the total", () => {
  const groups = groupByProject([row("a", "p1", "Building", "2026-10-10T01:00:00Z", null), row("b", "p1", "Building", "2026-10-10T02:00:00Z", "x")], pick);
  assert.equal(groups[0].total, 0);
});

test("bad input gives no groups", () => {
  assert.deepEqual(groupByProject(undefined, pick), []);
});

test("tick state is all, some or none", () => {
  assert.equal(tickState(0, 3), "none");
  assert.equal(tickState(2, 3), "some");
  assert.equal(tickState(3, 3), "all");
  assert.equal(tickState(0, 0), "none");
});

test("filtering by project keeps only its requests; null keeps all", () => {
  const list = [{ projectID: "p1" }, { projectID: "p2" }];
  assert.equal(filterByProject(list, "p1").length, 1);
  assert.equal(filterByProject(list, null).length, 2);
});

test("a scan for one project leaves out the other projects' requests", () => {
  const open = [{ ticketID: "t1", projectID: "p1" }, { ticketID: "t2", projectID: "p2" }, { ticketID: "t3", projectID: "p1" }];
  assert.deepEqual(outOfScopeTicketIDs(open, ["p1"]), ["t2"]);
  assert.deepEqual(outOfScopeTicketIDs(open, ["p1", "p2"]), []);
});

test("an unscoped scan leaves nothing out", () => {
  const open = [{ ticketID: "t1", projectID: "p1" }];
  assert.deepEqual(outOfScopeTicketIDs(open, null), []);
  assert.deepEqual(outOfScopeTicketIDs(open, []), []);
  assert.deepEqual(outOfScopeTicketIDs(undefined, ["p1"]), []);
});
