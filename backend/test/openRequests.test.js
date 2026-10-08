// F8 open-request scoping (UC-08-01 actors) and plan presentation.
const test = require("node:test");
const assert = require("node:assert/strict");
const { ticketScope, buildOpenRequestsQuery, buildLockQuery, loadOpenRequests } = require("../src/lib/openRequests");
const { planAllocation, presentPlan } = require("../src/lib/allocationPlan");

const USER = "11111111-1111-4111-8111-111111111111";

test("Purchaser sees requests assigned to them", () => {
  assert.deepEqual(ticketScope({ id: USER, role: "Purchaser" }), { clause: "t.assignedto = $1", params: [USER] });
});

test("Project Manager (backup actor) sees requests on projects they manage", () => {
  assert.deepEqual(ticketScope({ id: USER, role: "Project Manager" }), { clause: "p.projectmanagerid = $1", params: [USER] });
});

test("General Manager (backup actor) sees every open request", () => {
  assert.deepEqual(ticketScope({ id: USER, role: "General Manager" }), { clause: "TRUE", params: [] });
});

test("any other role gets 403", () => {
  assert.throws(() => ticketScope({ id: USER, role: "Site Manager" }), (error) => error.status === 403);
});

test("the lock and the open-request query use the same scope", () => {
  const user = { id: USER, role: "Project Manager" };
  const open = buildOpenRequestsQuery(user);
  const lock = buildLockQuery(user);
  assert.deepEqual(open.params, lock.params);
  assert.match(open.text, /p\.projectmanagerid = \$1/);
  assert.match(lock.text, /p\.projectmanagerid = \$1/);
  assert.match(lock.text, /FOR UPDATE OF t/);
  assert.match(open.text, /status <> 'Rejected'/);
  assert.match(open.text, /ORDER BY t\.createdat, t\.ticketid/);
});

test("loadOpenRequests uses the given client and converts DECIMAL strings", async () => {
  const calls = [];
  const client = {
    query: async (text, params) => {
      calls.push(params);
      return {
        rows: [{ ticketID: "t1", requestedQuantity: "20.00", remainingQuantity: "15.50", approvedBudget: null, remainingBudget: null }],
      };
    },
  };
  const rows = await loadOpenRequests({ id: USER, role: "Purchaser" }, client);
  assert.deepEqual(calls, [[USER]]);
  assert.equal(rows[0].requestedQuantity, 20);
  assert.equal(rows[0].remainingQuantity, 15.5);
  assert.equal(rows[0].remainingBudget, null);
});

test("presentPlan turns centavos into peso strings and hundredths into numbers", () => {
  const match = (d, m) => d.toLowerCase().includes(m);
  const tickets = [
    { ticketID: "00000000-0000-4000-8000-00000000000a", projectID: "a", projectName: "Alpha", materialType: "cement", remainingQuantity: 20, createdAt: "2026-10-01", remainingBudget: 5000 },
    { ticketID: "00000000-0000-4000-8000-00000000000b", projectID: "b", projectName: "Bravo", materialType: "cement", remainingQuantity: 30, createdAt: "2026-10-02" },
  ];
  const shown = presentPlan(planAllocation(
    [{ description: "Portland cement 40kg", quantity: 45, amount: 12600 }, { description: "Delivery fee", quantity: 0, amount: 500 }],
    tickets, {}, match
  ));
  assert.equal(shown.ok, true);
  assert.deepEqual(shown.problems, []);
  assert.deepEqual(shown.portions.map((p) => [p.projectName, p.quantity, p.amount, p.remainingAfter, p.resolvesTicket]), [
    ["Alpha", 20, "6100.00", 0, true],
    ["Bravo", 25, "7000.00", 5, false],
  ]);
  assert.equal(shown.linesTotal, "13100.00");
  assert.deepEqual(shown.warnings, [{ type: "OVER_BUDGET", ticketID: tickets[0].ticketID, amount: "6100.00", remainingBudget: "5000.00" }]);
});
