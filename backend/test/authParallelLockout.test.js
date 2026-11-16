// Wrong passwords sent at the same moment are all counted, so a burst can't
// get past the 5-attempt lock.
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

const state = { attempts: 0, lockoutuntil: null, counterReads: 0 };

stub("jose", {
  createRemoteJWKSet: () => ({}),
  jwtVerify: async () => ({ payload: { sub: "auth-1" } }),
});
stub("../src/lib/db", {
  query: async (sql, params) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (text.startsWith("select")) {
      if (text.includes("failedloginattempts")) state.counterReads += 1;
      return {
        rowCount: 1,
        rows: [{ userid: "u1", name: "T", username: "t", email: "t@gmail.com", role: "Purchaser", status: "Active", lockoutuntil: state.lockoutuntil, failedloginattempts: state.attempts }],
      };
    }
    // Same sum the database does: add 1, lock at the limit, skip a locked row.
    if (text.startsWith("update users") && text.includes("failedloginattempts + 1")) {
      if (state.lockoutuntil && new Date(state.lockoutuntil) > params[3]) return { rowCount: 0, rows: [] };
      const next = state.attempts + 1;
      if (next >= params[1]) {
        state.attempts = 0;
        state.lockoutuntil = params[2];
        return { rowCount: 1, rows: [{ failedloginattempts: 0, locked: true }] };
      }
      state.attempts = next;
      return { rowCount: 1, rows: [{ failedloginattempts: next, locked: false }] };
    }
    return { rowCount: 1, rows: [] };
  },
});
stub("../src/lib/supabaseAnon", {
  supabaseAnon: {
    auth: {
      // Slow on purpose, so every request in the burst has read the user before any of them writes.
      signInWithPassword: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { data: null, error: { message: "Invalid login credentials" } };
      },
    },
  },
});
stub("../src/routes/legal", { termsFields: async () => ({}) });

const authRouter = require("../src/routes/auth");

async function burst(count) {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/auth/login`;
    const one = () => fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "t@gmail.com", password: "wrong" }),
    }).then((res) => res.status);
    return await Promise.all(Array.from({ length: count }, one));
  } finally {
    server.close();
  }
}

test("10 wrong passwords at once: 4 are refused as wrong, the 5th and later are locked (423)", async () => {
  Object.assign(state, { attempts: 0, lockoutuntil: null, counterReads: 0 });
  const statuses = await burst(10);
  assert.equal(statuses.filter((s) => s === 401).length, 4, JSON.stringify(statuses));
  assert.equal(statuses.filter((s) => s === 423).length, 6, JSON.stringify(statuses));
  assert.ok(state.lockoutuntil, "the account ends up locked");
});

test("login no longer reads the counter to add 1 in JavaScript", async () => {
  Object.assign(state, { attempts: 0, lockoutuntil: null, counterReads: 0 });
  await burst(3);
  assert.equal(state.counterReads, 0);
});
