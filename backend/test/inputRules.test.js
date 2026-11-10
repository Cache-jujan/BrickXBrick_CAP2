// The shared rules every typed-in value passes: type, trim, length/range, clear message.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { LIMITS, InputError, text, amount, quantity, email, uuid, collect } = require("../src/lib/inputRules");

const fails = (fn, pattern) => assert.throws(fn, (err) => err instanceof InputError && err.status === 400 && pattern.test(err.message));

test("limits file for the web and phone matches the server's limits", () => {
  const shared = JSON.parse(fs.readFileSync(path.join(__dirname, "../../shared/input-limits.json"), "utf8"));
  assert.deepEqual(shared, { ...LIMITS });
});

test("text trims, keeps null for empty optional values, and refuses non-text", () => {
  assert.equal(text("  Cement  ", { field: "x", max: 20 }), "Cement");
  assert.equal(text("   ", { field: "x", max: 20 }), null);
  assert.equal(text(undefined, { field: "x", max: 20 }), null);
  fails(() => text("   ", { field: "x", label: "Subject", max: 20, required: true }), /Subject is required/);
  fails(() => text(["a"], { field: "x", label: "Subject", max: 20 }), /Subject must be text/);
  fails(() => text({ a: 1 }, { field: "x", label: "Subject", max: 20 }), /must be text/);
  fails(() => text(5, { field: "x", label: "Subject", max: 20 }), /must be text/);
});

test("text enforces the length in characters and names the limit", () => {
  assert.equal(text("a".repeat(100), { field: "x", max: 100 }).length, 100);
  fails(() => text("a".repeat(101), { field: "x", label: "Subject", max: 100 }), /Subject must be 100 characters or fewer/);
  // an emoji is one character to the user, not two
  assert.equal(text("😀".repeat(50), { field: "x", max: 50 }).length, 100);
});

test("text drops control characters and flattens line breaks on one-line fields", () => {
  assert.equal(text("a\u0000b\u0007c", { field: "x", max: 20 }), "abc");
  assert.equal(text("line one\r\nline two", { field: "x", max: 40 }), "line one line two");
  assert.equal(text("line one\r\nline two", { field: "x", max: 40, multiline: true }), "line one\nline two");
});

test("amount accepts numbers and plain numeric text, rounds to centavos", () => {
  assert.equal(amount(12.345, { field: "a" }), 12.35);
  assert.equal(amount("1500.5", { field: "a" }), 1500.5);
  assert.equal(amount(0, { field: "a", allowZero: true }), 0);
});

test("amount refuses zero, negatives, NaN, text, objects and too-large values", () => {
  fails(() => amount(0, { field: "a", label: "Amount" }), /more than 0/);
  fails(() => amount(-1, { field: "a", label: "Amount", allowZero: true }), /0 or more/);
  fails(() => amount(NaN, { field: "a", label: "Amount" }), /must be a number/);
  fails(() => amount(Infinity, { field: "a", label: "Amount" }), /must be a number/);
  fails(() => amount("12abc", { field: "a", label: "Amount" }), /must be a number/);
  fails(() => amount("1e5", { field: "a", label: "Amount" }), /must be a number/);
  fails(() => amount({}, { field: "a", label: "Amount" }), /must be a number/);
  fails(() => amount(1e18, { field: "a", label: "Amount" }), /must not be more than/);
  fails(() => amount(undefined, { field: "a", label: "Amount" }), /is required/);
});

test("quantity is capped to the column", () => {
  assert.equal(quantity(2.5), 2.5);
  fails(() => quantity(1e12), /Quantity must not be more than/);
  fails(() => quantity(0), /more than 0/);
});

test("email is lower-cased and must look like an address", () => {
  assert.equal(email(" Jun.Dela@Gmail.com "), "jun.dela@gmail.com");
  fails(() => email("not-an-email"), /valid email/);
  fails(() => email("a@b.co" + "m".repeat(200)), /150 characters or fewer/);
});

test("uuid refuses anything that is not an id", () => {
  assert.equal(uuid("b0000000-0000-4000-8000-000000000001", { field: "p" }), "b0000000-0000-4000-8000-000000000001");
  fails(() => uuid("abc", { field: "p", label: "Project" }), /Project is not a valid id/);
  fails(() => uuid(42, { field: "p", label: "Project" }), /not a valid id/);
  assert.equal(uuid(null, { field: "p", required: false }), null);
});

test("collect reports every bad field, not only the first", () => {
  const { errors, values } = collect([
    () => text("", { field: "name", label: "Name", required: true }),
    () => amount(-5, { field: "budget", label: "Budget" }),
    () => text("ok", { field: "city", max: 10 }),
  ]);
  assert.deepEqual(errors.map((e) => e.field), ["name", "budget"]);
  assert.equal(values[2], "ok");
});

test("an InputError carries details the shared error handler sends", () => {
  const err = new InputError("Name is required", "name");
  assert.deepEqual(err.details, { fieldErrors: [{ field: "name", message: "Name is required" }] });
});
