// Planning-task documents: the pure rules (lib/taskDocuments.js) and the
// routes in routes/tasks.js. The routes run for real; the database, auth and R2
// are replaced, same approach as reports.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

function stub(relative, exports) {
  const file = require.resolve(relative);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const PM = "11111111-1111-4111-8111-111111111111";
const OTHER_PM = "22222222-2222-4222-8222-222222222222";
const GM = "33333333-3333-4333-8333-333333333333";
const SM = "44444444-4444-4444-8444-444444444444";
const TASK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 2)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 3)]);

const state = {
  me: null,
  task: null,
  docs: [],
  puts: [],
  inserted: [],
  deleted: [],
};

function resetState() {
  state.me = { id: PM, name: "Test PM", role: "Project Manager" };
  state.task = {
    taskid: TASK,
    taskname: "File permit",
    status: "Pending",
    milestonephase: "Planning",
    projectmanagerid: PM,
    projectstatus: "Active",
  };
  state.docs = [];
  state.puts = [];
  state.inserted = [];
  state.deleted = [];
}

async function fakeQuery(sql, params = []) {
  const text = String(sql).replace(/\s+/g, " ").trim().toLowerCase();
  if (text.includes("from tasks t join milestones m")) {
    return params[0] === TASK ? { rows: [state.task], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (text.startsWith("select count(*) as n from task_documents")) {
    return { rows: [{ n: String(state.docs.filter((d) => !d.deleted).length) }], rowCount: 1 };
  }
  if (text.startsWith("insert into task_documents")) {
    const [taskId, uploadedBy, fileName, contentType, sizeBytes, sha256, storageKey] = params;
    state.inserted.push({ taskId, uploadedBy, fileName, contentType, sizeBytes, sha256, storageKey });
    return {
      rows: [{ documentID: DOC, taskID: taskId, fileName, contentType, sizeBytes, uploadedBy, uploadedAt: "2026-10-17T00:00:00Z" }],
      rowCount: 1,
    };
  }
  if (text.includes("from task_documents d left join users u")) {
    return { rows: state.docs.filter((d) => !d.deleted).map((d) => ({ documentID: d.id, fileName: d.fileName })), rowCount: 0 };
  }
  if (text.startsWith("select filename, storagekey from task_documents")) {
    const doc = state.docs.find((d) => d.id === params[0] && !d.deleted);
    return doc ? { rows: [{ filename: doc.fileName, storagekey: doc.key }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (text.startsWith("update task_documents")) {
    const doc = state.docs.find((d) => d.id === params[0] && !d.deleted);
    if (!doc) return { rows: [], rowCount: 0 };
    doc.deleted = true;
    state.deleted.push({ id: params[0], by: params[2] });
    return { rows: [{ documentid: doc.id }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

stub("../src/lib/db", {
  query: fakeQuery,
  withTransaction: async (fn) => fn({ query: fakeQuery }),
});
stub("../src/lib/r2", {
  uploadBuffer: async () => "https://cdn.example/unused.jpg",
  putObject: async (key, buffer, contentType) => {
    state.puts.push({ key, size: buffer.length, contentType });
    return `https://cdn.example/${key}`;
  },
  publicUrlForKey: (key) => `https://cdn.example/${key}`,
});
stub("../src/lib/milestoneProgress", { recalcMilestoneProgress: async () => {} });
stub("../src/middleware/auth", {
  requireAuth: (req, _res, next) => {
    req.user = state.me;
    next();
  },
});
const tasksRouter = require("../src/routes/tasks");
const docs = require("../src/lib/taskDocuments");

async function call(method, url, { file, name, type } = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/tasks", tasksRouter);
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  try {
    const { port } = server.address();
    let body;
    if (file) {
      body = new FormData();
      body.append("file", new Blob([file], { type }), name);
    }
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, body });
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, body: json };
  } finally {
    server.close();
  }
}

const upload = (file, name, type) => call("POST", `/api/tasks/${TASK}/documents`, { file, name, type });

// ---- pure rules ----

test("validateDocumentFile: accepts a real PDF, JPEG and PNG", () => {
  assert.deepEqual(docs.validateDocumentFile({ mimetype: "application/pdf", buffer: PDF }), { contentType: "application/pdf", ext: "pdf" });
  assert.deepEqual(docs.validateDocumentFile({ mimetype: "image/jpeg", buffer: JPG }), { contentType: "image/jpeg", ext: "jpg" });
  assert.deepEqual(docs.validateDocumentFile({ mimetype: "image/png", buffer: PNG }), { contentType: "image/png", ext: "png" });
});

test("validateDocumentFile: rejects wrong types, mismatched content, empty and missing files", () => {
  const bad = (file) => assert.throws(() => docs.validateDocumentFile(file), (e) => e.status === 400);
  bad(undefined);
  bad({ mimetype: "text/html", buffer: Buffer.from("<html>") });
  bad({ mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK\u0003\u0004") });
  bad({ mimetype: "application/pdf", buffer: Buffer.from("<html>not a pdf</html>") }); // declared PDF, isn't
  bad({ mimetype: "image/png", buffer: JPG }); // declared PNG, is JPEG
  bad({ mimetype: "application/pdf", buffer: Buffer.alloc(0) });
  bad({ mimetype: "application/pdf", buffer: Buffer.concat([PDF, Buffer.alloc(docs.MAX_DOCUMENT_BYTES)]) });
});

test("sanitizeFileName: keeps a normal name, strips folders and junk, falls back when nothing is left", () => {
  assert.equal(docs.sanitizeFileName("Building Permit.pdf", "pdf"), "Building Permit.pdf");
  assert.equal(docs.sanitizeFileName("..\\..\\etc/passwd", "pdf"), "passwd");
  assert.equal(docs.sanitizeFileName('a"b<c>d|e:f*g?h.pdf', "pdf"), "abcdefgh.pdf");
  assert.equal(docs.sanitizeFileName("line\nbreak\u0000.pdf", "pdf"), "linebreak.pdf");
  assert.equal(docs.sanitizeFileName("   ", "pdf"), "document.pdf");
  assert.equal(docs.sanitizeFileName("..", "png"), "document.png");
  assert.equal(docs.sanitizeFileName(undefined, "jpg"), "document.jpg");
  const long = docs.sanitizeFileName(`${"x".repeat(400)}.pdf`, "pdf");
  assert.ok(long.length <= 200 && long.endsWith(".pdf"));
});

test("buildStorageKey: a random key under the task, never from the filename", () => {
  const a = docs.buildStorageKey(TASK, "pdf");
  const b = docs.buildStorageKey(TASK, "pdf");
  assert.match(a, new RegExp(`^task-documents/${TASK}/[0-9a-f-]{36}\\.pdf$`));
  assert.notEqual(a, b);
});

test("sha256Hex: stable hex digest", () => {
  assert.equal(docs.sha256Hex(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

// ---- upload ----

test("upload: the owning PM attaches a PDF; it is stored under the task and recorded with its hash", async () => {
  resetState();
  const res = await upload(PDF, "Building Permit.pdf", "application/pdf");
  assert.equal(res.status, 201);
  assert.equal(res.body.fileName, "Building Permit.pdf");
  assert.equal(res.body.contentType, "application/pdf");
  assert.equal(res.body.uploadedByName, "Test PM");
  assert.equal(res.body.storageKey, undefined); // never exposed
  assert.equal(state.puts.length, 1);
  assert.match(state.puts[0].key, new RegExp(`^task-documents/${TASK}/`));
  assert.equal(state.puts[0].contentType, "application/pdf");
  assert.equal(state.inserted[0].sha256, docs.sha256Hex(PDF));
  assert.equal(state.inserted[0].sizeBytes, PDF.length);
  assert.equal(state.inserted[0].uploadedBy, PM);
});

test("upload: the GM can attach to any project's Planning task", async () => {
  resetState();
  state.me = { id: GM, name: "Test GM", role: "General Manager" };
  assert.equal((await upload(PNG, "title.png", "image/png")).status, 201);
});

test("upload: other PMs, Site Managers and other roles are refused and nothing is stored", async () => {
  resetState();
  state.me = { id: OTHER_PM, name: "Other PM", role: "Project Manager" };
  assert.equal((await upload(PDF, "a.pdf", "application/pdf")).status, 403);

  for (const role of ["Site Manager", "Purchaser", "System Administrator"]) {
    state.me = { id: SM, name: "X", role };
    assert.equal((await upload(PDF, "a.pdf", "application/pdf")).status, 403, role);
  }
  assert.equal(state.puts.length, 0);
});

test("upload: Construction tasks, completed tasks and closed projects are refused", async () => {
  resetState();
  state.task.milestonephase = "Construction";
  assert.equal((await upload(PDF, "a.pdf", "application/pdf")).status, 409);

  resetState();
  state.task.status = "Completed";
  assert.equal((await upload(PDF, "a.pdf", "application/pdf")).status, 409);

  for (const status of ["Completed", "Cancelled", "Archived"]) {
    resetState();
    state.task.projectstatus = status;
    assert.equal((await upload(PDF, "a.pdf", "application/pdf")).status, 409, status);
  }
  assert.equal(state.puts.length, 0);
});

test("upload: a Draft project accepts documents (planning happens before activation)", async () => {
  resetState();
  state.task.projectstatus = "Draft";
  assert.equal((await upload(PDF, "a.pdf", "application/pdf")).status, 201);
});

test("upload: bad files are a 400 and never reach storage", async () => {
  resetState();
  assert.equal((await upload(Buffer.from("<html></html>"), "x.pdf", "application/pdf")).status, 400);
  assert.equal((await upload(Buffer.from("hello"), "x.txt", "text/plain")).status, 400);
  assert.equal((await call("POST", `/api/tasks/${TASK}/documents`)).status, 400); // no file at all
  assert.equal(state.puts.length, 0);
});

test("upload: a file over 10MB is a 400 that says 'file', and never reaches storage", async () => {
  resetState();
  const big = Buffer.concat([PDF, Buffer.alloc(docs.MAX_DOCUMENT_BYTES)]);
  const res = await upload(big, "huge.pdf", "application/pdf");
  assert.equal(res.status, 400);
  assert.match(res.body.error, /file must be 10MB or smaller/);
  assert.equal(state.puts.length, 0);
});

test("upload: a task holds at most 10 documents", async () => {
  resetState();
  state.docs = Array.from({ length: docs.MAX_DOCUMENTS_PER_TASK }, (_, i) => ({ id: `d${i}`, fileName: `f${i}.pdf`, key: `k${i}` }));
  const res = await upload(PDF, "one-too-many.pdf", "application/pdf");
  assert.equal(res.status, 409);
  assert.equal(state.puts.length, 0);
});

test("upload: unknown or malformed task id is 404", async () => {
  resetState();
  const missing = await call("POST", "/api/tasks/cccccccc-cccc-4ccc-8ccc-cccccccccccc/documents", { file: PDF, name: "a.pdf", type: "application/pdf" });
  assert.equal(missing.status, 404);
  const malformed = await call("POST", "/api/tasks/not-a-uuid/documents", { file: PDF, name: "a.pdf", type: "application/pdf" });
  assert.equal(malformed.status, 404);
});

// ---- list / download / delete ----

test("list: GM and the owning PM can read; others cannot", async () => {
  resetState();
  state.docs = [{ id: DOC, fileName: "permit.pdf", key: "task-documents/x/y.pdf" }];
  const ok = await call("GET", `/api/tasks/${TASK}/documents`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.length, 1);

  state.me = { id: GM, name: "GM", role: "General Manager" };
  assert.equal((await call("GET", `/api/tasks/${TASK}/documents`)).status, 200);

  state.me = { id: OTHER_PM, name: "Other PM", role: "Project Manager" };
  assert.equal((await call("GET", `/api/tasks/${TASK}/documents`)).status, 403);
  state.me = { id: SM, name: "SM", role: "Site Manager" };
  assert.equal((await call("GET", `/api/tasks/${TASK}/documents`)).status, 403);
});

test("list: still readable after the task is completed or the project is closed", async () => {
  resetState();
  state.task.status = "Completed";
  state.task.projectstatus = "Archived";
  assert.equal((await call("GET", `/api/tasks/${TASK}/documents`)).status, 200);
});

test("download: returns the url and file name, and 404s a missing or deleted document", async () => {
  resetState();
  state.docs = [{ id: DOC, fileName: "permit.pdf", key: "task-documents/x/y.pdf" }];
  const ok = await call("GET", `/api/tasks/${TASK}/documents/${DOC}/download`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { url: "https://cdn.example/task-documents/x/y.pdf", fileName: "permit.pdf" });

  assert.equal((await call("GET", `/api/tasks/${TASK}/documents/cccccccc-cccc-4ccc-8ccc-cccccccccccc/download`)).status, 404);
  assert.equal((await call("GET", `/api/tasks/${TASK}/documents/nope/download`)).status, 404);

  state.docs[0].deleted = true;
  assert.equal((await call("GET", `/api/tasks/${TASK}/documents/${DOC}/download`)).status, 404);
});

test("download: someone without access gets 403, not the url", async () => {
  resetState();
  state.docs = [{ id: DOC, fileName: "permit.pdf", key: "task-documents/x/y.pdf" }];
  state.me = { id: OTHER_PM, name: "Other PM", role: "Project Manager" };
  assert.equal((await call("GET", `/api/tasks/${TASK}/documents/${DOC}/download`)).status, 403);
});

test("delete: soft-deletes while the task is open, records who, and 404s a second time", async () => {
  resetState();
  state.docs = [{ id: DOC, fileName: "permit.pdf", key: "k" }];
  const res = await call("DELETE", `/api/tasks/${TASK}/documents/${DOC}`);
  assert.equal(res.status, 204);
  assert.deepEqual(state.deleted, [{ id: DOC, by: PM }]);
  assert.equal((await call("DELETE", `/api/tasks/${TASK}/documents/${DOC}`)).status, 404);
});

test("delete: locked once the task is completed, and refused for people without access", async () => {
  resetState();
  state.docs = [{ id: DOC, fileName: "permit.pdf", key: "k" }];
  state.task.status = "Completed";
  assert.equal((await call("DELETE", `/api/tasks/${TASK}/documents/${DOC}`)).status, 409);

  resetState();
  state.docs = [{ id: DOC, fileName: "permit.pdf", key: "k" }];
  state.me = { id: OTHER_PM, name: "Other PM", role: "Project Manager" };
  assert.equal((await call("DELETE", `/api/tasks/${TASK}/documents/${DOC}`)).status, 403);
  assert.equal(state.deleted.length, 0);
});
