// CORS allow-list: the web app and listed origins pass, other websites do not,
// and requests without an Origin header (mobile app, curl, health checks) pass.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const cors = require("cors");

const { corsOptions, allowedOrigins, isAllowedOrigin, toOrigin } = require("../src/lib/corsOptions");

const PROD = { NODE_ENV: "production", FRONTEND_URL: "https://brick.example.com/", CORS_ORIGINS: "https://preview-1.example.com, https://preview-2.example.com/x" };
const check = (origin, env = PROD) => isAllowedOrigin(origin, allowedOrigins(env), env);

test("toOrigin keeps only scheme and host, and rejects junk", () => {
  assert.equal(toOrigin("https://brick.example.com/set-password/"), "https://brick.example.com");
  assert.equal(toOrigin("  http://127.0.0.1:5173 "), "http://127.0.0.1:5173");
  for (const bad of ["", "   ", undefined, null, "not a url", "null"]) assert.equal(toOrigin(bad), null, String(bad));
});

test("production allows FRONTEND_URL and every CORS_ORIGINS entry", () => {
  assert.equal(check("https://brick.example.com"), true);
  assert.equal(check("https://preview-1.example.com"), true);
  assert.equal(check("https://preview-2.example.com"), true);
});

test("production refuses other websites, near misses and the string null", () => {
  for (const origin of ["https://evil.example.com", "http://brick.example.com", "https://brick.example.com.evil.io", "https://sub.brick.example.com", "null"]) {
    assert.equal(check(origin), false, origin);
  }
});

test("a request with no Origin header is always allowed", () => {
  assert.equal(check(undefined), true);
  assert.equal(check(undefined, { NODE_ENV: "production" }), true);
});

test("localhost is refused in production but allowed otherwise", () => {
  assert.equal(check("http://localhost:5173"), false);
  assert.equal(check("http://127.0.0.1:5173"), false);
  const dev = { FRONTEND_URL: "http://127.0.0.1:5173" };
  assert.equal(check("http://localhost:5173", dev), true);
  assert.equal(check("http://127.0.0.1:8081", dev), true);
  assert.equal(check("http://localhost.evil.io", dev), false);
});

test("with nothing configured in production, only requests without an Origin get through", () => {
  const env = { NODE_ENV: "production" };
  assert.equal(check("https://brick.example.com", env), false);
  assert.equal(check(undefined, env), true);
});

test("middleware: allowed origin gets the header, other origin does not, both still get the response", async () => {
  const logged = [];
  const app = express();
  app.use(cors(corsOptions(PROD, (m) => logged.push(m))));
  app.get("/ping", (req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/ping`;
  try {
    const good = await fetch(url, { headers: { Origin: "https://brick.example.com" } });
    assert.equal(good.headers.get("access-control-allow-origin"), "https://brick.example.com");

    const bad = await fetch(url, { headers: { Origin: "https://evil.example.com" } });
    assert.equal(bad.status, 200);
    assert.equal(bad.headers.get("access-control-allow-origin"), null);
    await fetch(url, { headers: { Origin: "https://evil.example.com" } });
    assert.equal(logged.length, 1, "each refused origin is logged once");

    const none = await fetch(url);
    assert.equal(none.status, 200);

    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example.com", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" },
    });
    assert.equal(preflight.headers.get("access-control-allow-origin"), null);
  } finally {
    server.close();
  }
});
