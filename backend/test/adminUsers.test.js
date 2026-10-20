// F1 — "Enforce change password upon login" and safe role changes.
//
//   1. The System Administrator can only SEND a password email; no route
//      accepts a password typed by an admin.
//   2. A role change or deactivation is refused while the person still holds
//      open work (projects, tasks, material requests), naming what to reassign.
//
// The routes run for real; the database, auth and Supabase are replaced.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { describeOpenWork, hasOpenWork } = require("../src/lib/userOpenWork");

process.env.FRONTEND_URL = "http://127.0.0.1:5173";

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const USER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const state = {
  user: null, // the Users row
  authUser: null, // the Supabase auth user
  openProjects: [],
  openTasks: 0,
  openRequests: 0,
  calls: [],
  me: { id: "admin-1", role: "System Administrator" },
};

/** Record SQL calls and return user and open-work fixtures for the admin route tests. */
async function fakeQuery(sql, params = []) {
  const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  state.calls.push({ text, params });
  if (text.startsWith("select 1 from users where email")) return { rowCount: 0, rows: [] };
  if (text.startsWith("insert into users")) {
    return { rowCount: 1, rows: [{ userid: "new-1", name: params[0], email: params[1], role: params[3], status: "Active" }] };
  }
  if (text.startsWith("select userid, name, email, role, status, supabaseuserid from users")) {
    return state.user ? { rowCount: 1, rows: [state.user] } : { rowCount: 0, rows: [] };
  }
  if (text.startsWith("select name, case when projectmanagerid")) {
    return { rowCount: state.openProjects.length, rows: state.openProjects.map((name) => ({ name, asrole: "Project Manager" })) };
  }
  if (text.includes("from tasks t")) return { rowCount: 1, rows: [{ n: state.openTasks }] };
  if (text.includes("from tickets")) return { rowCount: 1, rows: [{ n: state.openRequests }] };
  if (text.startsWith("update users set role")) {
    return { rowCount: 1, rows: [{ ...state.user, role: params[0] || state.user.role, status: params[1] || state.user.status }] };
  }
  if (text.startsWith("update users set status = 'inactive'")) return { rowCount: 1, rows: [{ userid: USER_ID, status: "Inactive" }] };
  return { rowCount: 1, rows: [] };
}

const supabase = { recovery: [], invites: [], inviteOpts: [], passwordUpdates: [] };
stub("../src/lib/db", { query: fakeQuery });
stub("../src/middleware/auth", {
  requireAuth: (req, _res, next) => {
    req.user = state.me;
    next();
  },
});
stub("../src/lib/supabaseAdmin", {
  supabaseAdmin: {
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: state.authUser }, error: null }),
        /** Capture the invite recipient and options, then return a synthetic auth user. */
        inviteUserByEmail: async (email, opts) => {
          supabase.invites.push(email);
          supabase.inviteOpts.push(opts);
          return { data: { user: { id: "auth-1" } }, error: null };
        },
        updateUserById: async (id, attrs) => {
          supabase.passwordUpdates.push({ id, attrs });
          return { data: {}, error: null };
        },
      },
    },
  },
});
stub("../src/lib/supabaseAnon", {
  supabaseAnon: {
    auth: {
      resetPasswordForEmail: async (email, opts) => {
        supabase.recovery.push({ email, opts });
        return { data: {}, error: null };
      },
    },
  },
});

const adminRouter = require("../src/routes/adminUsers");

/** Restore the user, auth state, open work, and captured calls before each route test. */
function reset({ confirmed = true, status = "Active" } = {}) {
  state.user = {
    userid: USER_ID,
    name: "Test PM",
    email: "testpm.sample@gmail.com",
    role: "Project Manager",
    status,
    supabaseuserid: "auth-1",
  };
  state.authUser = { id: "auth-1", email_confirmed_at: confirmed ? "2026-09-01T00:00:00Z" : null };
  state.openProjects = [];
  state.openTasks = 0;
  state.openRequests = 0;
  state.calls.length = 0;
  state.me = { id: "admin-1", role: "System Administrator" };
  supabase.recovery.length = 0;
  supabase.invites.length = 0;
  supabase.inviteOpts.length = 0;
  supabase.passwordUpdates.length = 0;
}

async function call(method, url, body) {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/users", adminRouter);
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } finally {
    server.close();
  }
}

// ---- 1. password emails ------------------------------------------------------

test("send password email to an active account: recovery link, old password retired, lockout cleared", async () => {
  reset({ confirmed: true });
  const res = await call("POST", `/api/admin/users/${USER_ID}/send-password-email`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.channel, "recovery");
  assert.equal(supabase.recovery.length, 1);
  assert.equal(supabase.recovery[0].email, "testpm.sample@gmail.com");
  assert.equal(supabase.recovery[0].opts.redirectTo, "http://127.0.0.1:5173/set-password");
  assert.equal(supabase.passwordUpdates.length, 1, "old password replaced");
  assert.ok(supabase.passwordUpdates[0].attrs.password.length >= 32, "random throwaway, not a chosen one");
  assert.ok(state.calls.some((c) => c.text.includes("lockoutuntil = null")), "lockout cleared");
});

test("send password email to an account that never set a password: the invite is sent again", async () => {
  reset({ confirmed: false });
  const res = await call("POST", `/api/admin/users/${USER_ID}/send-password-email`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.channel, "invite");
  assert.deepEqual(supabase.invites, ["testpm.sample@gmail.com"]);
  assert.equal(supabase.inviteOpts[0].redirectTo, "http://127.0.0.1:5173/set-password");
  assert.equal(supabase.recovery.length, 0);
});

test("a new account's invite email opens the Set your password page, not Sign in", async () => {
  reset();
  const res = await call("POST", "/api/admin/users", {
    name: "Sample Purchaser",
    email: "samplebuyer@gmail.com",
    role: "Purchaser",
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(supabase.invites, ["samplebuyer@gmail.com"]);
  assert.equal(supabase.inviteOpts[0].redirectTo, "http://127.0.0.1:5173/set-password");
  assert.deepEqual(supabase.inviteOpts[0].data, { role: "Purchaser" });
});

test("a deactivated account gets no password email", async () => {
  reset({ status: "Inactive" });
  const res = await call("POST", `/api/admin/users/${USER_ID}/send-password-email`);
  assert.equal(res.status, 409);
  assert.equal(supabase.recovery.length + supabase.invites.length, 0);
});

test("no route accepts an admin-typed password any more", async () => {
  reset();
  const res = await call("POST", `/api/admin/users/${USER_ID}/reset-password`, { newPassword: "Chosen-By-Admin-1" });
  assert.equal(res.status, 404);
  assert.equal(supabase.passwordUpdates.length, 0);
});

test("only a System Administrator can send password emails", async () => {
  reset();
  state.me = { id: "gm-1", role: "General Manager" };
  const res = await call("POST", `/api/admin/users/${USER_ID}/send-password-email`);
  assert.equal(res.status, 403);
});

// ---- 2. role change / deactivation guard ------------------------------------

test("changing the role of a PM who still manages open projects is refused, naming them", async () => {
  reset();
  state.openProjects = ["Mandaue Riverside Food Park", "PickleHaus Indoor Courts"];
  const res = await call("PATCH", `/api/admin/users/${USER_ID}`, { role: "Purchaser" });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "user_has_open_work");
  assert.match(res.body.error, /Test PM still manages 2 open projects \(Mandaue Riverside Food Park, PickleHaus Indoor Courts\)/);
  assert.ok(!state.calls.some((c) => c.text.startsWith("update users set role")), "nothing changed");
});

test("deactivating someone with unfinished tasks is refused", async () => {
  reset();
  state.openTasks = 3;
  const res = await call("POST", `/api/admin/users/${USER_ID}/deactivate`);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /has 3 unfinished tasks/);
});

test("deactivating through PATCH status is guarded the same way", async () => {
  reset();
  state.openRequests = 1;
  const res = await call("PATCH", `/api/admin/users/${USER_ID}`, { status: "Inactive" });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /1 material request waiting on them/);
});

test("with no open work, the role change goes through", async () => {
  reset();
  const res = await call("PATCH", `/api/admin/users/${USER_ID}`, { role: "Purchaser" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.role, "Purchaser");
});

test("reactivating or saving the same role is never blocked", async () => {
  reset({ status: "Inactive" });
  state.openProjects = ["Old Project"];
  const reactivate = await call("PATCH", `/api/admin/users/${USER_ID}`, { status: "Active" });
  assert.equal(reactivate.status, 200);
  reset();
  state.openProjects = ["Old Project"];
  const sameRole = await call("PATCH", `/api/admin/users/${USER_ID}`, { role: "Project Manager" });
  assert.equal(sameRole.status, 200);
});

test("the open-work message lists at most three projects and joins the parts", () => {
  const work = { projects: ["A", "B", "C", "D"].map((name) => ({ name })), openTasks: 1, openRequests: 2 };
  assert.ok(hasOpenWork(work));
  assert.equal(
    describeOpenWork("Juan", work),
    "Juan still manages 4 open projects (A, B, C, +1 more), has 1 unfinished task and has 2 material requests waiting on them. Reassign them first, then try again."
  );
  assert.equal(hasOpenWork({ projects: [], openTasks: 0, openRequests: 0 }), false);
});

test("PATCH refuses a status other than Active or Inactive", async () => {
  reset();
  for (const bad of ["Suspended", "", null, 5]) {
    const res = await call("PATCH", `/api/admin/users/${USER_ID}`, { status: bad });
    assert.equal(res.status, 400, `status ${JSON.stringify(bad)} refused`);
    assert.match(res.body.error, /Active or Inactive/);
  }
  assert.ok(!state.calls.some((c) => c.text.startsWith("update users")), "nothing written");
});
