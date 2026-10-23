// supabaseRefresh.js — how Supabase's answer to a refresh is read.
const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = "https://project.supabase.co/";
process.env.SUPABASE_ANON_KEY = "anon-key";

const { refreshWithSupabase } = require("../src/lib/supabaseRefresh");

const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("a good answer becomes a session, and the request is a plain refresh_token grant", async () => {
  let seen;
  const fetchFn = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, json: async () => ({ access_token: "a", refresh_token: "r", expires_at: 1900000000, user: { id: "auth-1" } }) };
  };
  const result = await refreshWithSupabase("old-refresh", fetchFn);
  assert.deepEqual(result, { ok: true, session: { accessToken: "a", refreshToken: "r", expiresAt: 1900000000, supabaseUserId: "auth-1" } });
  assert.equal(seen.url, "https://project.supabase.co/auth/v1/token?grant_type=refresh_token");
  assert.equal(seen.init.headers.apikey, "anon-key");
  assert.deepEqual(JSON.parse(seen.init.body), { refresh_token: "old-refresh" });
});

test("Supabase refusing the token (400, 401, 403, 422) is { ok: false }, not an error", async () => {
  for (const status of [400, 401, 403, 422]) {
    const result = await refreshWithSupabase("x", reply(status, { error_code: "refresh_token_not_found" }));
    assert.deepEqual(result, { ok: false }, `status ${status}`);
  }
});

test("a 200 without both tokens is not accepted as a session", async () => {
  assert.deepEqual(await refreshWithSupabase("x", reply(200, { access_token: "a" })), { ok: false });
});

test("5xx, 429 and network failures throw, so the caller says 'try again later'", async () => {
  for (const status of [500, 502, 503, 429]) {
    await assert.rejects(refreshWithSupabase("x", reply(status, {})), /answered/, `status ${status}`);
  }
  await assert.rejects(refreshWithSupabase("x", async () => { throw new Error("fetch failed"); }), /fetch failed/);
});
