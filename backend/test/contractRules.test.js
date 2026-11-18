// F2: contract and client payments. The contract holds the terms the client
// agreed to; payments record what the client actually paid. Neither changes the
// project's spending budget.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateContractBody,
  validatePaymentBody,
  paymentSchedule,
  paymentProblem,
  contractChangeProblem,
  priceDifference,
  bomContractWarning,
  sameName,
  ledgerSummary,
} = require("../src/lib/contractRules");

const TODAY = "2026-11-18";
const goodContract = {
  contractDate: "2026-10-20",
  contractRef: "  C-2026-014 ",
  ownerName: "  Maria   Santos ",
  contractorName: "Sample Builders",
  contractAmount: "2800000",
  downPaymentPercent: 20,
  retentionPercent: "10",
  durationWorkingDays: "120",
  warrantyMonths: 12,
};
const contract = { contractAmount: 2800000, downPaymentPercent: 20, retentionPercent: 10 };
const live = (kind, amount) => ({ kind, amount, voidedAt: null });

test("a complete contract is accepted and tidied", () => {
  const r = validateContractBody(goodContract, TODAY);
  assert.deepEqual(r.errors, []);
  assert.equal(r.value.ownerName, "Maria Santos");
  assert.equal(r.value.contractRef, "C-2026-014");
  assert.equal(r.value.contractAmount, 2800000);
  assert.equal(r.value.retentionPercent, 10);
  assert.equal(r.value.durationWorkingDays, 120);
  assert.equal(r.value.scope, null);
});

test("required fields, bad money and bad percentages are all reported together", () => {
  const r = validateContractBody({ contractAmount: -5, downPaymentPercent: 120, retentionPercent: "abc" }, TODAY);
  const fields = r.errors.map((e) => e.field);
  for (const f of ["contractDate", "ownerName", "contractorName", "contractAmount", "downPaymentPercent", "retentionPercent"]) {
    assert.ok(fields.includes(f), `expected an error on ${f}`);
  }
});

test("the contract date must be a real date and not in the future", () => {
  assert.equal(validateContractBody({ ...goodContract, contractDate: "2026-02-30" }, TODAY).errors[0].field, "contractDate");
  assert.equal(validateContractBody({ ...goodContract, contractDate: "2026-12-01" }, TODAY).errors[0].message, "Contract date can't be in the future");
  assert.equal(validateContractBody({ ...goodContract, contractDate: "20/10/2026" }, TODAY).errors[0].field, "contractDate");
});

test("down payment and retention together can't pass 100%", () => {
  const r = validateContractBody({ ...goodContract, downPaymentPercent: 60, retentionPercent: 50 }, TODAY);
  assert.deepEqual(r.errors.map((e) => e.field), ["retentionPercent"]);
});

test("percentages and counts reject the wrong kind of value", () => {
  assert.equal(validateContractBody({ ...goodContract, downPaymentPercent: -1 }, TODAY).errors[0].field, "downPaymentPercent");
  assert.equal(validateContractBody({ ...goodContract, durationWorkingDays: 12.5 }, TODAY).errors[0].field, "durationWorkingDays");
  assert.equal(validateContractBody({ ...goodContract, warrantyMonths: 0 }, TODAY).errors[0].field, "warrantyMonths");
  assert.equal(validateContractBody({ ...goodContract, ownerName: "x".repeat(151) }, TODAY).errors[0].field, "ownerName");
  assert.equal(validateContractBody({ ...goodContract, ownerName: ["Maria"] }, TODAY).errors[0].field, "ownerName");
});

test("the schedule splits the contract amount into down payment, billings and retention", () => {
  assert.deepEqual(paymentSchedule(contract), {
    contractAmount: 2800000,
    downPaymentAmount: 560000,
    retentionAmount: 280000,
    progressBillingsAmount: 1960000,
  });
  // the sample contract from the client: 40% down, 10% retention
  assert.deepEqual(paymentSchedule({ contractAmount: 2800000, downPaymentPercent: 40, retentionPercent: 10 }), {
    contractAmount: 2800000,
    downPaymentAmount: 1120000,
    retentionAmount: 280000,
    progressBillingsAmount: 1400000,
  });
});

test("a payment needs a valid type, amount and date", () => {
  const ok = validatePaymentBody({ kind: "Progress Billing", amount: "150000.50", receivedOn: "2026-11-10", workDonePercent: 35 }, TODAY);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.value.amount, 150000.5);
  assert.equal(ok.value.workDonePercent, 35);

  const bad = validatePaymentBody({ kind: "Gift", amount: 0, receivedOn: "2027-01-01" }, TODAY);
  assert.deepEqual(bad.errors.map((e) => e.field), ["kind", "amount", "receivedOn"]);
});

test("work done is only kept on a progress billing", () => {
  const r = validatePaymentBody({ kind: "Down Payment", amount: 560000, receivedOn: "2026-10-21", workDonePercent: 10 }, TODAY);
  assert.equal(r.value.workDonePercent, null);
});

test("only one down payment per contract", () => {
  const msg = paymentProblem({ kind: "Down Payment", amount: 1 }, contract, [live("Down Payment", 560000)], "Active");
  assert.match(msg, /already recorded/);
  assert.equal(paymentProblem({ kind: "Down Payment", amount: 560000 }, contract, [], "Active"), null);
});

test("progress billings can't eat into the retention", () => {
  const paid = [live("Down Payment", 560000), live("Progress Billing", 1900000)];
  assert.equal(paymentProblem({ kind: "Progress Billing", amount: 60000 }, contract, paid, "Active"), null);
  const msg = paymentProblem({ kind: "Progress Billing", amount: 60000.01 }, contract, paid, "Active");
  assert.match(msg, /₱60,000\.00 can still be collected/);
});

test("the retention is released only at turn-over and only up to its amount", () => {
  assert.match(paymentProblem({ kind: "Retention", amount: 280000 }, contract, [], "Active"), /once the project is Completed/);
  assert.equal(paymentProblem({ kind: "Retention", amount: 280000 }, contract, [], "Completed"), null);
  assert.match(paymentProblem({ kind: "Retention", amount: 280000.01 }, contract, [], "Completed"), /₱280,000\.00/);
  assert.match(paymentProblem({ kind: "Retention", amount: 1 }, contract, [live("Retention", 280000)], "Completed"), /already recorded/);
});

test("a voided payment no longer counts", () => {
  const summary = ledgerSummary({
    contract,
    payments: [{ kind: "Down Payment", amount: 560000, voidedAt: "2026-11-01" }, live("Down Payment", 560000)],
    spent: 0,
    projectBudget: null,
    workDonePercent: null,
  });
  assert.equal(summary.receivedTotal, 560000);
});

test("changing the contract can't contradict payments already received", () => {
  const paid = [live("Down Payment", 560000), live("Progress Billing", 1000000)];
  assert.equal(contractChangeProblem(contract, paid), null);
  assert.match(contractChangeProblem({ ...contract, contractAmount: 1500000 }, paid), /already been received/);
  assert.match(contractChangeProblem({ ...contract, retentionPercent: 60 }, paid), /already been received/);
});

test("the ledger shows received, still to collect and cash position in pesos", () => {
  const s = ledgerSummary({
    contract,
    payments: [live("Down Payment", 560000), live("Progress Billing", 700000)],
    spent: 432038,
    projectBudget: 2800000,
    workDonePercent: 50,
  });
  assert.equal(s.receivedTotal, 1260000);
  assert.equal(s.receivedPercent, 45);
  assert.equal(s.remainingToCollect, 1540000);
  assert.equal(s.cashPosition, 827962);
  assert.deepEqual(s.receivedByKind, { "Down Payment": 560000, "Progress Billing": 700000, Retention: 0 });
  assert.deepEqual(s.warnings, []);
});

test("it warns when spending is ahead of cash received", () => {
  const s = ledgerSummary({ contract, payments: [live("Down Payment", 560000)], spent: 689282, projectBudget: null, workDonePercent: null });
  const w = s.warnings.find((x) => x.code === "SPEND_AHEAD_OF_CASH");
  assert.equal(w.level, "warning");
  assert.match(w.message, /₱689,282\.00/);
  assert.match(w.message, /₱560,000\.00/);
  assert.equal(s.cashPosition, -129282);
});

test("it flags a missing down payment and collection that lags the work", () => {
  const s = ledgerSummary({ contract, payments: [], spent: 0, projectBudget: null, workDonePercent: 50 });
  const codes = s.warnings.map((w) => w.code);
  assert.deepEqual(codes, ["DOWN_PAYMENT_NOT_RECORDED", "COLLECTION_BEHIND_WORK"]);
  // within 10 points of the work done is fine
  const close = ledgerSummary({ contract, payments: [live("Down Payment", 560000), live("Progress Billing", 840000)], spent: 0, projectBudget: null, workDonePercent: 55 });
  assert.equal(close.warnings.some((w) => w.code === "COLLECTION_BEHIND_WORK"), false);
});

test("the contract amount is compared with the agreed price, and the budget stays separate", () => {
  assert.equal(priceDifference(2154955, null), null);
  assert.deepEqual(priceDifference(2154955, 2154955), { agreedPrice: 2154955, difference: 0, differs: false });
  assert.deepEqual(priceDifference(2500000, 2154955), { agreedPrice: 2154955, difference: 345045, differs: true });

  // Santos: agreed price 2,154,955; budget with 5% escalation 2,262,702.75
  const santos = { ...contract, contractAmount: 2154955 };
  const same = ledgerSummary({ contract: santos, payments: [], spent: 0, agreedPrice: 2154955, projectBudget: 2262702.75 });
  assert.equal(same.warnings.some((w) => w.code === "CONTRACT_DIFFERS_FROM_AGREED_PRICE"), false);
  const above = same.warnings.find((w) => w.code === "BUDGET_ABOVE_CONTRACT");
  assert.equal(above.level, "info");
  assert.match(above.message, /₱2,262,702\.75/);
  assert.match(above.message, /₱107,747\.75/);

  const off = ledgerSummary({ contract: { ...contract, contractAmount: 2500000 }, payments: [], spent: 0, agreedPrice: 2154955, projectBudget: 2262702.75 });
  const differs = off.warnings.find((w) => w.code === "CONTRACT_DIFFERS_FROM_AGREED_PRICE");
  assert.equal(differs.level, "warning");
  assert.match(differs.message, /₱345,045\.00/);
});

test("a BOM total that differs from the recorded contract gives a warning, never a block", () => {
  assert.equal(bomContractWarning(1241983.75, 1241983.75), null);
  assert.equal(bomContractWarning(1241983.75, null), null);
  const higher = bomContractWarning(1300000, 1241983.75);
  assert.equal(higher.level, "warning");
  assert.equal(higher.code, "CONTRACT_DIFFERS_FROM_BOM");
  assert.match(higher.message, /₱58,016\.25 higher than this BOM total \(₱1,241,983\.75\)/);
  assert.match(bomContractWarning(1200000, 1241983.75).message, /₱41,983\.75 lower/);
});

test("the contract owner is compared with the project client loosely, and only warns", () => {
  assert.equal(sameName("Juan A. Dela Cruz", "Juan Dela Cruz"), true);
  assert.equal(sameName("MR. JUAN DELA CRUZ", "juan  dela cruz"), true);
  assert.equal(sameName("Dela Cruz, Juan", "Juan Dela Cruz"), true);
  assert.equal(sameName("Maria Santos", "Juan Dela Cruz"), false);
  assert.equal(sameName("", "Juan Dela Cruz"), true);
  const contract = { contractAmount: 1000000, downPaymentPercent: 20, retentionPercent: 10, ownerName: "Maria Santos" };
  const different = ledgerSummary({ contract, payments: [], spent: 0, clientName: "Juan Dela Cruz" });
  assert.ok(different.warnings.some((w) => w.code === "CLIENT_NAME_DIFFERS" && w.level === "warning"));
  const same = ledgerSummary({ contract: { ...contract, ownerName: "Juan A. Dela Cruz" }, payments: [], spent: 0, clientName: "Juan Dela Cruz" });
  assert.ok(!same.warnings.some((w) => w.code === "CLIENT_NAME_DIFFERS"));
  const unknown = ledgerSummary({ contract, payments: [], spent: 0 });
  assert.ok(!unknown.warnings.some((w) => w.code === "CLIENT_NAME_DIFFERS"));
});
