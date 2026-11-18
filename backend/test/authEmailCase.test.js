// F1: the login email is not case-sensitive ("CarlReyt@gmail.com" = "carlreyt@gmail.com").
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

const seen = { lookup: null, signInEmail: null };
const stored = { userid: "u1", name: "Carl", username: null, email: "carlreyt@gmail.com", role: "General Manager", status: "Active", lockoutuntil: null, avatarurl: null };

stub("../src/lib/db", {
  query: async (sql, params = []) => {
    const text = String(sql).replace(/\s+/g, " ").trim();
    if (/^SELECT .* FROM users WHERE LOWER\(email\) = \$1/i.test(text)) {
      seen.lookup = params[0];
      return params[0] === stored.email ? { rowCount: 1, rows: [stored] } : { rowCount: 0, rows: [] };
    }
    return { rowCount: 1, rows: [] };
  },
});
stub("../src/lib/supabaseAnon", {
  supabaseAnon: {
    auth: {
      signInWithPassword: async ({ email }) => {
        seen.signInEmail = email;
        return { data: { session: { access_token: "t", refresh_token: "r", expires_at: 1 } }, error: null };
      },
    },
  },
});
stub("../src/routes/legal", { termsFields: async () => ({}) });

const authRouter = require("../src/routes/auth");

async function login(email) {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "pw" }),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test("a mixed-case email with spaces signs in to the same account", async () => {
  const r = await login("  CarlReyt@Gmail.com ");
  assert.equal(r.status, 200);
  assert.equal(seen.lookup, "carlreyt@gmail.com");
  assert.equal(seen.signInEmail, "carlreyt@gmail.com");
  assert.equal(r.body.user.email, "carlreyt@gmail.com");
});

test("a missing email is still a 400", async () => {
  assert.equal((await login("")).status, 400);
});
