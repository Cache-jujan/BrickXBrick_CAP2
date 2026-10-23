// F1 — the mobile app keeps its sign-in alive: login hands out a refresh token,
// and POST /api/auth/refresh swaps it for a new access token. A deactivated or
// locked account is refused, and Supabase being down is not "signed out".
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

process.env.SUPABASE_JWKS_URL = "http://localhost/jwks";
process.env.SUPABASE_URL = "http://localhost";

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const state = { user: null, refresh: null, refreshCalls: [] };

stub("../src/lib/db", {
  query: async (sql) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (text.startsWith("select") && state.user) return { rowCount: 1, rows: [state.user] };
    if (text.startsWith("select")) return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [] };
  },
});
stub("../src/lib/supabaseAnon", {
  supabaseAnon: {
    auth: {
      signInWithPassword: async () => ({
        data: { session: { access_token: "access-1", refresh_token: "refresh-1", expires_at: 1900000000 } },
        error: null,
      }),
    },
  },
});
stub("../src/lib/supabaseRefresh", {
  refreshWithSupabase: async (refreshToken) => {
    state.refreshCalls.push(refreshToken);
    if (state.refresh instanceof Error) throw state.refresh;
    return state.refresh;
  },
});
stub("../src/routes/legal", { termsFields: async () => ({}) });

const authRouter = require("../src/routes/auth");

function setUser(over = {}) {
  state.user = {
    userid: "u1", name: "Test", email: "t@gmail.com", role: "Site Manager",
    status: "Active", lockoutuntil: null, failedloginattempts: 0, ...over,
  };
  state.refreshCalls = [];
  state.refresh = {
    ok: true,
    session: { accessToken: "access-2", refreshToken: "refresh-2", expiresAt: 1900003600, supabaseUserId: "auth-1" },
  };
}

async function post(path, body) {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/auth${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test("login also returns the refresh token and when the access token ends", async () => {
  setUser();
  const r = await post("/login", { email: "t@gmail.com", password: "pw" });
  assert.equal(r.status, 200);
  assert.equal(r.body.token, "access-1");
  assert.equal(r.body.refreshToken, "refresh-1");
  assert.equal(r.body.expiresAt, 1900000000);
});

test("refresh: a valid refresh token returns a new access token and the next refresh token", async () => {
  setUser();
  const r = await post("/refresh", { refreshToken: "refresh-1" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { token: "access-2", refreshToken: "refresh-2", expiresAt: 1900003600 });
  assert.deepEqual(state.refreshCalls, ["refresh-1"]);
});

test("refresh: a missing or non-text refresh token is a 400 and Supabase is not asked", async () => {
  setUser();
  assert.equal((await post("/refresh", {})).status, 400);
  assert.equal((await post("/refresh", { refreshToken: 42 })).status, 400);
  assert.equal(state.refreshCalls.length, 0);
});

test("refresh: a refresh token Supabase no longer accepts is a 401", async () => {
  setUser();
  state.refresh = { ok: false };
  const r = await post("/refresh", { refreshToken: "old" });
  assert.equal(r.status, 401);
  assert.equal(r.body.token, undefined);
});

test("refresh: a deactivated account is refused and gets no token", async () => {
  setUser({ status: "Inactive" });
  const r = await post("/refresh", { refreshToken: "refresh-1" });
  assert.equal(r.status, 403);
  assert.equal(r.body.token, undefined);
});

test("refresh: a locked account is refused with 423", async () => {
  setUser({ lockoutuntil: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  const r = await post("/refresh", { refreshToken: "refresh-1" });
  assert.equal(r.status, 423);
  assert.equal(r.body.token, undefined);
});

test("refresh: a token for someone with no account here is a 401", async () => {
  setUser();
  state.user = null;
  const r = await post("/refresh", { refreshToken: "refresh-1" });
  assert.equal(r.status, 401);
});

test("refresh: Supabase being unreachable is a 503, not a sign-out", async () => {
  setUser();
  state.refresh = new Error("fetch failed");
  const r = await post("/refresh", { refreshToken: "refresh-1" });
  assert.equal(r.status, 503);
  assert.equal(r.body.token, undefined);
});
