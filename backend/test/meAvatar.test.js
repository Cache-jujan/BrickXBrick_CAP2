// POST/DELETE /api/me/avatar — only real JPEG/PNG pictures up to 2 MB are stored.
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

const state = { updates: [], uploads: [] };

stub("jose", { createRemoteJWKSet: () => ({}), jwtVerify: async () => ({ payload: { sub: "auth-1" } }) });
stub("../src/lib/db", {
  query: async (sql, params) => {
    const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
    if (text.startsWith("select") && text.includes("where supabaseuserid")) {
      return { rowCount: 1, rows: [{ userid: "u1", name: "T", username: "t", email: "t@gmail.com", role: "Purchaser", status: "Active", lockoutuntil: null, avatarurl: null }] };
    }
    if (text.startsWith("update")) state.updates.push({ text, params });
    return { rowCount: 1, rows: [] };
  },
});
stub("../src/lib/supabaseAnon", { supabaseAnon: {} });
stub("../src/lib/supabaseAdmin", { supabaseAdmin: {} });
stub("../src/lib/r2", {
  uploadBuffer: async (buffer, opts) => {
    state.uploads.push({ size: buffer.length, ...opts });
    return `https://cdn.example/${opts.keyPrefix}/abc.${opts.contentType === "image/png" ? "png" : "jpg"}`;
  },
});

const meRouter = require("../src/routes/me");

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);

async function call(method, path, body) {
  const app = express();
  app.use(express.json());
  app.use("/api/me", meRouter);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
  try {
    const init = { method, headers: { Authorization: "Bearer x" } };
    if (body) init.body = body;
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/me${path}`, init);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } finally {
    server.close();
  }
}

function photo(buffer, name = "me.jpg", type = "image/jpeg") {
  const form = new FormData();
  form.append("photo", new Blob([buffer], { type }), name);
  return form;
}

test("a JPEG is stored under the user's folder and the URL saved", async () => {
  state.updates = []; state.uploads = [];
  const r = await call("POST", "/avatar", photo(JPEG));
  assert.equal(r.status, 200);
  assert.match(r.body.avatarUrl, /avatars\/u1\/abc\.jpg$/);
  assert.equal(state.uploads[0].keyPrefix, "avatars/u1");
  assert.equal(state.uploads[0].contentType, "image/jpeg");
  assert.deepEqual(state.updates[0].params, [r.body.avatarUrl, "u1"]);
});

test("a PNG is accepted too", async () => {
  state.updates = []; state.uploads = [];
  const r = await call("POST", "/avatar", photo(PNG, "me.png", "image/png"));
  assert.equal(r.status, 200);
  assert.equal(state.uploads[0].contentType, "image/png");
});

test("the file's real bytes decide, not its name or claimed type", async () => {
  state.updates = []; state.uploads = [];
  const r = await call("POST", "/avatar", photo(Buffer.from("<html>not an image</html>"), "me.jpg", "image/jpeg"));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /JPEG or PNG/);
  assert.equal(state.uploads.length, 0);
  assert.equal(state.updates.length, 0);
});

test("a picture over 2 MB is refused", async () => {
  state.uploads = [];
  const big = Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]);
  const r = await call("POST", "/avatar", photo(big));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /2 MB/);
  assert.equal(state.uploads.length, 0);
});

test("no file at all is a 400", async () => {
  const r = await call("POST", "/avatar", new FormData());
  assert.equal(r.status, 400);
});

test("removing the picture clears the saved URL", async () => {
  state.updates = [];
  const r = await call("DELETE", "/avatar");
  assert.equal(r.status, 200);
  assert.equal(r.body.avatarUrl, null);
  assert.deepEqual(state.updates[0].params, ["u1"]);
});
