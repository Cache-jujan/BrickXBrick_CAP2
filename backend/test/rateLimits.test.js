// API rate limits: general backstop, failed-only login and change-password
// limits, and per-client counting behind one proxy (Cloud Run).

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const { makeRateLimiters } = require("../src/lib/rateLimits");

/** A tiny app wired like server.js: trust proxy 1, limiters before the routes. */
async function startApp(limits) {
  const rl = makeRateLimiters(limits);
  const app = express();
  app.set("trust proxy", 1);
  app.get("/health", (req, res) => res.json({ ok: true })); // outside /api: never limited
  app.use("/api", rl.general);
  app.use("/api/auth/login", rl.login);
  app.use("/api/me/change-password", rl.changePassword);
  app.use(express.json());
  // Login stub: the password "right" succeeds, anything else is a 401.
  app.post("/api/auth/login", (req, res) => (req.body.password === "right" ? res.json({ ok: true }) : res.status(401).json({ error: "Invalid email or password" })));
  app.post("/api/me/change-password", (req, res) => (req.body.password === "right" ? res.json({ ok: true }) : res.status(401).json({ error: "wrong" })));
  app.get("/api/ping", (req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { ip = "203.0.113.1", method = "GET", password } = {}) =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
      body: method === "POST" ? JSON.stringify({ email: "a@b.c", password }) : undefined,
    });
  return { call, close: () => server.close() };
}

test("login: the failed attempt after the limit gets 429, with a JSON error", async () => {
  const { call, close } = await startApp({ login: { limit: 3 } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await call("/api/auth/login", { method: "POST", password: "bad" })).status, 401);
    const blocked = await call("/api/auth/login", { method: "POST", password: "bad" });
    assert.equal(blocked.status, 429);
    assert.match((await blocked.json()).error, /failed sign-in attempts/i);
  } finally { close(); }
});

test("login: successful sign-ins are not counted", async () => {
  const { call, close } = await startApp({ login: { limit: 2 } });
  try {
    for (let i = 0; i < 10; i++) assert.equal((await call("/api/auth/login", { method: "POST", password: "right" })).status, 200);
    assert.equal((await call("/api/auth/login", { method: "POST", password: "bad" })).status, 401);
  } finally { close(); }
});

test("each client IP behind the proxy has its own count (trust proxy 1)", async () => {
  const { call, close } = await startApp({ login: { limit: 2 } });
  try {
    for (let i = 0; i < 2; i++) await call("/api/auth/login", { method: "POST", password: "bad", ip: "198.51.100.7" });
    assert.equal((await call("/api/auth/login", { method: "POST", password: "bad", ip: "198.51.100.7" })).status, 429);
    assert.equal((await call("/api/auth/login", { method: "POST", password: "bad", ip: "198.51.100.8" })).status, 401);
  } finally { close(); }
});

test("change-password: failed attempts are limited the same way", async () => {
  const { call, close } = await startApp({ changePassword: { limit: 2 } });
  try {
    for (let i = 0; i < 2; i++) assert.equal((await call("/api/me/change-password", { method: "POST", password: "bad" })).status, 401);
    assert.equal((await call("/api/me/change-password", { method: "POST", password: "bad" })).status, 429);
  } finally { close(); }
});

test("general limit covers /api routes but never /health", async () => {
  const { call, close } = await startApp({ general: { limit: 3 } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await call("/api/ping")).status, 200);
    assert.equal((await call("/api/ping")).status, 429);
    for (let i = 0; i < 10; i++) assert.equal((await call("/health")).status, 200);
  } finally { close(); }
});

test("a limited response carries the standard rate-limit headers", async () => {
  const { call, close } = await startApp({ general: { limit: 5 } });
  try {
    const res = await call("/api/ping");
    assert.ok(res.headers.get("ratelimit") || res.headers.get("ratelimit-limit"), "has RateLimit header");
    assert.equal(res.headers.get("x-ratelimit-limit"), null, "no legacy headers");
  } finally { close(); }
});
