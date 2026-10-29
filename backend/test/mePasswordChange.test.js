// POST /api/me/change-password — the current password is required, and wrong
// guesses count toward the same lockout as the login screen.
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

const state = { attempts: 0, lockoutuntil: null, passwordOk: true, signIns: 0, adminUpdates: [], updates: [] };

stub("jose", {
  createRemoteJWKSet: () => ({}),
  jwtVerify: async () => ({ payload: { sub: "auth-1" } }),
});
stub("../src/lib/db", {
  query: async (sql, params) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (text.startsWith("select") && text.includes("where supabaseuserid")) {
      return { rowCount: 1, rows: [{ userid: "u1", name: "T", username: "t", email: "t@gmail.com", role: "Purchaser", status: "Active", lockoutuntil: state.lockoutuntil }] };
    }
    if (text.startsWith("select") && text.includes("failedloginattempts")) {
      return { rowCount: 1, rows: [{ email: "t@gmail.com", supabaseuserid: "auth-1", failedloginattempts: state.attempts }] };
    }
    if (text.startsWith("update")) state.updates.push({ text, params });
    return { rowCount: 1, rows: [] };
  },
});
stub("../src/lib/supabaseAnon", {
  supabaseAnon: {
    auth: {
      signInWithPassword: async () => {
        state.signIns += 1;
        return state.passwordOk ? { data: { session: {} }, error: null } : { data: null, error: { message: "Invalid login credentials" } };
      },
    },
  },
});
stub("../src/lib/supabaseAdmin", {
  supabaseAdmin: { auth: { admin: { updateUserById: async (id, body) => { state.adminUpdates.push({ id, body }); return { error: null }; } } } },
});

const meRouter = require("../src/routes/me");

function reset(over = {}) {
  Object.assign(state, { attempts: 0, lockoutuntil: null, passwordOk: true, signIns: 0, adminUpdates: [], updates: [] }, over);
}

async function change(body) {
  const app = express();
  app.use(express.json());
  app.use("/api/me", meRouter);
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/me/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer x" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } finally {
    server.close();
  }
}

const good = { currentPassword: "old-password", newPassword: "new-password-1" };

test("a wrong current password is refused, counted, and says how many tries are left", async () => {
  reset({ passwordOk: false, attempts: 0 });
  const r = await change(good);
  assert.equal(r.status, 401);
  assert.match(r.body.error, /4 attempts left/);
  assert.equal(state.adminUpdates.length, 0, "the password must not change");
  assert.deepEqual(state.updates[0].params, [1, null, "u1"]);
});

test("the last try before the lock says 1 attempt left", async () => {
  reset({ passwordOk: false, attempts: 3 });
  const r = await change(good);
  assert.equal(r.status, 401);
  assert.match(r.body.error, /1 attempt left/);
});

test("the 5th wrong current password locks the account for 15 minutes", async () => {
  reset({ passwordOk: false, attempts: 4 });
  const before = Date.now();
  const r = await change(good);
  assert.equal(r.status, 423);
  assert.match(r.body.error, /locked for 15 minutes/);
  const [attempts, until, id] = state.updates[0].params;
  assert.equal(attempts, 0, "the counter restarts once the lock is set");
  assert.equal(id, "u1");
  const minutes = (new Date(until).getTime() - before) / 60000;
  assert.ok(minutes > 14.9 && minutes < 15.1, `locked for ${minutes} minutes`);
  assert.equal(state.adminUpdates.length, 0);
});

test("a locked account is refused before it can try any password", async () => {
  reset({ lockoutuntil: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
  const r = await change(good);
  assert.equal(r.status, 423);
  assert.equal(state.signIns, 0);
});

test("the right current password changes it and clears earlier wrong guesses", async () => {
  reset({ attempts: 3 });
  const r = await change(good);
  assert.equal(r.status, 204);
  assert.equal(state.adminUpdates.length, 1);
  assert.equal(state.adminUpdates[0].body.password, "new-password-1");
  assert.ok(state.updates.some((u) => u.text.includes("failedloginattempts = 0")));
});

test("the new password must differ, be long enough, and the current one is required", async () => {
  reset();
  assert.equal((await change({ currentPassword: "same-pass-1", newPassword: "same-pass-1" })).status, 400);
  assert.equal((await change({ currentPassword: "old-password", newPassword: "short" })).status, 400);
  assert.equal((await change({ newPassword: "new-password-1" })).status, 400);
  assert.equal(state.signIns, 0, "bad input never reaches the password check");
});
