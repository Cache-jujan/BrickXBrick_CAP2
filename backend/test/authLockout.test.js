// F1 — account lockout holds on every API call, and the login route does not
// reveal account state to someone who does not know the password.
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

const state = { user: null, passwordOk: true, signIns: 0 };

stub("jose", {
  createRemoteJWKSet: () => ({}),
  jwtVerify: async () => ({ payload: { sub: "auth-1" } }),
});
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
      signInWithPassword: async () => {
        state.signIns += 1;
        return state.passwordOk
          ? { data: { session: { access_token: "t" } }, error: null }
          : { data: null, error: { message: "Invalid login credentials" } };
      },
    },
  },
});
stub("../src/routes/legal", { termsFields: async () => ({}) });

const { requireAuth } = require("../src/middleware/auth");
const authRouter = require("../src/routes/auth");

function setUser(over = {}) {
  state.user = {
    userid: "u1", name: "Test", email: "t@gmail.com", role: "Project Manager",
    status: "Active", lockoutuntil: null, failedloginattempts: 0, ...over,
  };
  state.passwordOk = true;
  state.signIns = 0;
}

async function withServer(setup, fn) {
  const app = express();
  app.use(express.json());
  setup(app);
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

const future = () => new Date(Date.now() + 10 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 10 * 60 * 1000).toISOString();

async function api(lockoutuntil, status = "Active") {
  setUser({ lockoutuntil, status });
  return withServer((app) => app.get("/me", requireAuth, (req, res) => res.json(req.user)), async (base) => {
    const res = await fetch(`${base}/me`, { headers: { Authorization: "Bearer x" } });
    return { status: res.status, body: await res.json() };
  });
}

test("requireAuth refuses a locked account even with a valid token", async () => {
  const r = await api(future());
  assert.equal(r.status, 423);
  assert.ok(r.body.lockoutUntil);
});

test("requireAuth lets the account in once the lockout has passed or was never set", async () => {
  assert.equal((await api(past())).status, 200);
  assert.equal((await api(null)).status, 200);
});

test("requireAuth still refuses a deactivated account", async () => {
  assert.equal((await api(null, "Inactive")).status, 403);
});

async function login(over, passwordOk) {
  setUser(over);
  state.passwordOk = passwordOk;
  return withServer((app) => app.use("/api/auth", authRouter), async (base) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "t@gmail.com", password: "pw" }),
    });
    return { status: res.status, body: await res.json() };
  });
}

test("login: a deactivated account with a wrong password gets the generic message", async () => {
  const r = await login({ status: "Inactive" }, false);
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "Invalid email or password");
});

test("login: a deactivated account is told so only after the right password", async () => {
  const r = await login({ status: "Inactive" }, true);
  assert.equal(r.status, 403);
  assert.equal(r.body.token, undefined);
});

test("login: an active account signs in normally", async () => {
  const r = await login({}, true);
  assert.equal(r.status, 200);
  assert.equal(r.body.token, "t");
});
