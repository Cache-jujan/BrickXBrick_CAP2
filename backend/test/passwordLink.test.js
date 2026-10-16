// F1 — new-account invite and password emails must open /set-password.
// If redirectTo is missing or malformed, Supabase opens its Site URL instead
// and the new user lands on Sign in with no password (bug reported 2026-10-16).
const test = require("node:test");
const assert = require("node:assert/strict");
const { setPasswordUrl, frontendBase } = require("../src/lib/passwordLink");

const req = (origin) => ({ get: (h) => (h.toLowerCase() === "origin" ? origin : undefined) });

test("FRONTEND_URL is used and a trailing slash does not double up", () => {
  assert.equal(setPasswordUrl(req(), { FRONTEND_URL: "http://127.0.0.1:5173/" }), "http://127.0.0.1:5173/set-password");
  assert.equal(setPasswordUrl(req(), { FRONTEND_URL: "https://brickxbrick.example.com" }), "https://brickxbrick.example.com/set-password");
});

test("FRONTEND_URL wins over the browser's origin", () => {
  assert.equal(
    setPasswordUrl(req("http://localhost:5173"), { FRONTEND_URL: "https://app.example.com" }),
    "https://app.example.com/set-password"
  );
});

test("without FRONTEND_URL the admin's own web address is used", () => {
  assert.equal(setPasswordUrl(req("http://127.0.0.1:5173"), {}), "http://127.0.0.1:5173/set-password");
});

test("no usable address gives undefined, never 'undefined/set-password'", () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(setPasswordUrl(req(), {}), undefined);
    assert.equal(setPasswordUrl(req("null"), { FRONTEND_URL: "   " }), undefined);
  } finally {
    console.warn = warn;
  }
  assert.equal(frontendBase({ FRONTEND_URL: "not a url" }, null), null);
});
