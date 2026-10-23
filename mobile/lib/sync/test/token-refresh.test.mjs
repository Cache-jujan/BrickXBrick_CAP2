// Keeping the sign-in alive (lib/sync/token-refresh.js): when to refresh, what
// each answer from the server means, and that two refreshes never run at once.
// Run from mobile/:  npm test
import test from "node:test";
import assert from "node:assert/strict";

const { createTokenRefresher } = await import("../token-refresh.js");

const NOW_MS = 1_900_000_000_000; // a fixed "now", in milliseconds
const nowSeconds = NOW_MS / 1000;

function makeSession(over = {}) {
  return { token: "access-1", refreshToken: "refresh-1", expiresAt: nowSeconds + 3600, user: { id: "u1", role: "Site Manager" }, ...over };
}

// A refresher over a fake session store and a fake server.
function setup({ session = makeSession(), reply } = {}) {
  const store = { session, saved: [] };
  const sent = [];
  const refresher = createTokenRefresher({
    getSession: () => store.session,
    setSession: (next) => {
      store.session = next;
      store.saved.push(next);
    },
    apiUrl: "http://api.test",
    nowMs: () => NOW_MS,
    fetchFn: async (url, init) => {
      sent.push({ url, init });
      return reply ? reply() : { status: 200, ok: true, json: async () => ({ token: "access-2", refreshToken: "refresh-2", expiresAt: nowSeconds + 7200 }) };
    },
  });
  return { store, sent, refresher };
}
const status = (code) => () => ({ status: code, ok: code >= 200 && code < 300, json: async () => ({}) });

test("a good refresh saves the new access token AND the new refresh token, and keeps the user", async () => {
  const { store, sent, refresher } = setup();
  assert.equal(await refresher.refreshSession(), "refreshed");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "http://api.test/api/auth/refresh");
  assert.deepEqual(JSON.parse(sent[0].init.body), { refreshToken: "refresh-1" });
  assert.deepEqual(store.session, makeSession({ token: "access-2", refreshToken: "refresh-2", expiresAt: nowSeconds + 7200 }));
});

test("no refresh token on this phone (an older sign-in) -> 'unavailable', nothing is sent", async () => {
  const { sent, refresher } = setup({ session: makeSession({ refreshToken: undefined }) });
  assert.equal(await refresher.refreshSession(), "unavailable");
  assert.equal(sent.length, 0);
});

test("signed out -> 'unavailable', nothing is sent", async () => {
  const { sent, refresher } = setup({ session: null });
  assert.equal(await refresher.refreshSession(), "unavailable");
  assert.equal(sent.length, 0);
});

test("two refreshes at the same moment send ONE request and share the answer (a refresh token works once)", async () => {
  const { sent, refresher } = setup();
  const [a, b] = await Promise.all([refresher.refreshSession(), refresher.refreshSession()]);
  assert.deepEqual([a, b], ["refreshed", "refreshed"]);
  assert.equal(sent.length, 1);
  // ...and a later refresh is a new request again.
  await refresher.refreshSession();
  assert.equal(sent.length, 2);
});

test("the server refusing the refresh token (401, 403 deactivated, 423 locked) -> 'rejected', session untouched", async () => {
  for (const code of [401, 403, 423]) {
    const { store, refresher } = setup({ reply: status(code) });
    assert.equal(await refresher.refreshSession(), "rejected", `status ${code}`);
    assert.equal(store.saved.length, 0);
    assert.equal(store.session.token, "access-1");
  }
});

test("an older backend without the route (404) -> 'unavailable', so the old sign-out behaviour applies", async () => {
  const { refresher } = setup({ reply: status(404) });
  assert.equal(await refresher.refreshSession(), "unavailable");
});

test("server trouble (500, 503) or no network -> 'later': never a sign-out, session untouched", async () => {
  for (const reply of [status(500), status(503)]) {
    const { store, refresher } = setup({ reply });
    assert.equal(await refresher.refreshSession(), "later");
    assert.equal(store.saved.length, 0);
  }
  const { store, refresher } = setup({ reply: () => { throw new Error("Network request failed"); } });
  assert.equal(await refresher.refreshSession(), "later");
  assert.equal(store.saved.length, 0);
});

test("a reply without tokens is not trusted -> 'later'", async () => {
  const { store, refresher } = setup({ reply: () => ({ status: 200, ok: true, json: async () => ({ token: "only-access" }) }) });
  assert.equal(await refresher.refreshSession(), "later");
  assert.equal(store.saved.length, 0);
});

test("if they signed out, or another person signed in, while the request was running, the answer is thrown away", async () => {
  for (const after of [null, makeSession({ user: { id: "someone-else", role: "Purchaser" }, refreshToken: "theirs" })]) {
    const { store, refresher } = setup();
    const original = store.session;
    // The session changes while the (fake) request is in flight.
    const slow = createTokenRefresher({
      getSession: () => store.session,
      setSession: (next) => store.saved.push(next),
      apiUrl: "http://api.test",
      nowMs: () => NOW_MS,
      fetchFn: async () => {
        store.session = after;
        return { status: 200, ok: true, json: async () => ({ token: "access-2", refreshToken: "refresh-2", expiresAt: nowSeconds + 7200 }) };
      },
    });
    assert.equal(await slow.refreshSession(), "later");
    assert.equal(store.saved.length, 0); // the old person's tokens are never saved for someone else
    assert.notEqual(original, undefined);
    void refresher;
  }
});

test("ensureFreshToken: plenty of time left -> 'fresh', nothing sent", async () => {
  const { sent, refresher } = setup({ session: makeSession({ expiresAt: nowSeconds + 3600 }) });
  assert.equal(await refresher.ensureFreshToken(), "fresh");
  assert.equal(sent.length, 0);
});

test("ensureFreshToken: about to end (under a minute) or already ended -> refreshes first", async () => {
  for (const expiresAt of [nowSeconds + 30, nowSeconds - 5000]) {
    const { store, sent, refresher } = setup({ session: makeSession({ expiresAt }) });
    assert.equal(await refresher.ensureFreshToken(), "refreshed");
    assert.equal(sent.length, 1);
    assert.equal(store.session.token, "access-2");
  }
});

test("ensureFreshToken: an old sign-in with no refresh token or no end time is left alone", async () => {
  for (const over of [{ refreshToken: undefined }, { expiresAt: undefined }]) {
    const { sent, refresher } = setup({ session: makeSession(over) });
    assert.equal(await refresher.ensureFreshToken(), "fresh");
    assert.equal(sent.length, 0);
  }
});

test("ensureFreshToken passes on 'rejected' and 'later' so the caller can decide", async () => {
  const expired = makeSession({ expiresAt: nowSeconds - 10 });
  assert.equal(await setup({ session: expired, reply: status(401) }).refresher.ensureFreshToken(), "rejected");
  assert.equal(await setup({ session: expired, reply: status(503) }).refresher.ensureFreshToken(), "later");
});

test("a request that never answers is given up on after the timeout -> 'later'", async () => {
  const store = { session: makeSession() };
  const refresher = createTokenRefresher({
    getSession: () => store.session,
    setSession: (next) => (store.session = next),
    apiUrl: "http://api.test",
    nowMs: () => NOW_MS,
    timeoutMs: 20,
    // Never answers by itself; only gives up when the app aborts it.
    fetchFn: (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))),
  });
  assert.equal(await refresher.refreshSession(), "later");
  assert.equal(store.session.token, "access-1");
});

test("ensureFreshToken does not hammer a server that cannot be reached: after 'later' it waits 10 s before trying again", async () => {
  let now = NOW_MS;
  let tries = 0;
  const store = { session: makeSession({ expiresAt: nowSeconds - 10 }) };
  const refresher = createTokenRefresher({
    getSession: () => store.session,
    setSession: (next) => (store.session = next),
    apiUrl: "http://api.test",
    nowMs: () => now,
    fetchFn: async () => {
      tries += 1;
      throw new Error("Network request failed");
    },
  });
  assert.equal(await refresher.ensureFreshToken(), "later");
  assert.equal(await refresher.ensureFreshToken(), "later"); // too soon: not even tried
  assert.equal(tries, 1);
  now += 11_000;
  await refresher.ensureFreshToken();
  assert.equal(tries, 2);
  // An explicit refresh (after a 401) is always tried.
  await refresher.refreshSession();
  assert.equal(tries, 3);
});

test("a fetch that throws at once (not as a rejected promise) does not leave the refresher stuck", async () => {
  let tries = 0;
  const store = { session: makeSession() };
  const refresher = createTokenRefresher({
    getSession: () => store.session,
    setSession: (next) => (store.session = next),
    apiUrl: "http://api.test",
    nowMs: () => NOW_MS,
    fetchFn: () => {
      tries += 1;
      if (tries === 1) throw new Error("boom"); // synchronous
      return { status: 200, ok: true, json: async () => ({ token: "access-2", refreshToken: "refresh-2", expiresAt: nowSeconds + 7200 }) };
    },
  });
  assert.equal(await refresher.refreshSession(), "later");
  assert.equal(await refresher.refreshSession(), "refreshed"); // a new attempt, not the old answer
  assert.equal(tries, 2);
});
