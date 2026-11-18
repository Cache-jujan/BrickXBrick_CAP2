// contract.js (F2): the construction contract and the client's payments.
// Mounted at /api/projects/:projectId/contract (server.js).
//
// Flow: the BOM is approved (the client agrees on the price) -> the GM records
// the signed contract -> the project can be activated (routes/projects.js).
// The contract is NOT the spending budget: the budget stays the agreed price
// plus escalation (routes/bom.js). Client payments are income, tracked here so
// the project shows what was received, what is still to collect, and the cash
// position (received minus approved spending).
//
//   GET    /                         GM, owning PM   contract, payments, ledger summary
//   POST   /extract                  GM              read an uploaded .docx, PROPOSE values (saves nothing)
//   PUT    /                         GM              confirm / update the contract
//   POST   /payments                 GM              record money received
//   PATCH  /payments/:paymentId/void GM              void a wrong payment (reason required)
//
// A payment is never edited or deleted, only voided with a reason, so the
// record stays complete.

const express = require("express");
const multer = require("multer");
const { query, withTransaction } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { httpError } = require("../lib/projectRules");
const { agreedPrice } = require("./bom");
const { extractContract } = require("../lib/contractExtract");
const { InputError, text } = require("../lib/inputRules");
const {
  DEFAULT_DOWN_PAYMENT_PERCENT,
  DEFAULT_RETENTION_PERCENT,
  validateContractBody,
  validatePaymentBody,
  paymentProblem,
  contractChangeProblem,
  priceDifference,
  ledgerSummary,
  peso,
} = require("../lib/contractRules");

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

const GM = "General Manager";
const PM = "Project Manager";
const CONTRACT_EDITABLE_STATUSES = ["Draft", "Active"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

function sendError(res, err) {
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "The file is larger than 5 MB." : err.message;
    return res.status(400).json({ error: message });
  }
  // Two requests recorded the same down payment or retention at once: the
  // database's one-live-row rule caught the second.
  if (err.code === "23505" && !err.status) {
    return res.status(409).json({ error: "That payment is already recorded. Refresh the page." });
  }
  if (!err.status) console.error("Contract route error:", err);
  res.status(err.status || 500).json({ error: err.status ? err.message : "Internal server error", ...(err.details || {}) });
}

const runnerOf = (target) => (typeof target === "function" ? target : (t, p) => target.query(t, p));
const num = (v) => (v === null || v === undefined ? null : Number(v));

async function loadProject(target, projectId, { lock = false } = {}) {
  if (!UUID_RE.test(String(projectId))) throw httpError(404, "Project not found");
  const result = await runnerOf(target)(
    `SELECT projectid, name, status, budget, clientname, siteaddress, municipality,
            projectmanagerid
       FROM projects WHERE projectid = $1::uuid${lock ? " FOR UPDATE" : ""}`,
    [projectId]
  );
  if (result.rowCount === 0) throw httpError(404, "Project not found");
  return result.rows[0];
}

function assertCanView(project, user) {
  if (user.role === GM) return;
  if (user.role === PM && project.projectmanagerid === user.id) return;
  throw httpError(403, "You do not have access to this project's contract");
}

async function loadContract(target, projectId, { lock = false } = {}) {
  const result = await runnerOf(target)(
    `SELECT c.contractid, c.projectid, c.contractref, to_char(c.contractdate, 'YYYY-MM-DD') AS contractdate,
            c.ownername, c.contractorname, c.contractorrep, c.contractoraddress, c.scope, c.sitelocation,
            c.contractamount::text AS contractamount, c.downpaymentpercent::text AS downpaymentpercent,
            c.retentionpercent::text AS retentionpercent, c.durationworkingdays, c.warrantymonths,
            c.sourcefilename, c.createdat, c.updatedat, uc.name AS createdbyname, uu.name AS updatedbyname
       FROM projectcontracts c
       JOIN users uc ON uc.userid = c.createdby
       LEFT JOIN users uu ON uu.userid = c.updatedby
      WHERE c.projectid = $1::uuid${lock ? " FOR UPDATE OF c" : ""}`,
    [projectId]
  );
  const r = result.rows[0];
  if (!r) return null;
  return {
    contractId: r.contractid,
    projectId: r.projectid,
    contractRef: r.contractref,
    contractDate: r.contractdate,
    ownerName: r.ownername,
    contractorName: r.contractorname,
    contractorRep: r.contractorrep,
    contractorAddress: r.contractoraddress,
    scope: r.scope,
    siteLocation: r.sitelocation,
    contractAmount: Number(r.contractamount),
    downPaymentPercent: Number(r.downpaymentpercent),
    retentionPercent: Number(r.retentionpercent),
    durationWorkingDays: r.durationworkingdays,
    warrantyMonths: r.warrantymonths,
    sourceFileName: r.sourcefilename,
    createdAt: r.createdat,
    updatedAt: r.updatedat,
    createdByName: r.createdbyname,
    updatedByName: r.updatedbyname,
  };
}

// Every payment of the contract, newest first, voided ones included (marked).
async function loadPayments(target, contractId) {
  const result = await runnerOf(target)(
    `SELECT p.paymentid, p.kind, p.amount::text AS amount, to_char(p.receivedon, 'YYYY-MM-DD') AS receivedon,
            p.referenceno, p.workdonepercent::text AS workdonepercent, p.note,
            p.recordedat, ur.name AS recordedbyname,
            p.voidedat, p.voidreason, uv.name AS voidedbyname
       FROM clientpayments p
       JOIN users ur ON ur.userid = p.recordedby
       LEFT JOIN users uv ON uv.userid = p.voidedby
      WHERE p.contractid = $1::uuid
      ORDER BY p.receivedon DESC, p.recordedat DESC`,
    [contractId]
  );
  return result.rows.map((r) => ({
    paymentId: r.paymentid,
    kind: r.kind,
    amount: Number(r.amount),
    receivedOn: r.receivedon,
    referenceNo: r.referenceno,
    workDonePercent: num(r.workdonepercent),
    note: r.note,
    recordedAt: r.recordedat,
    recordedByName: r.recordedbyname,
    voidedAt: r.voidedat,
    voidReason: r.voidreason,
    voidedByName: r.voidedbyname,
  }));
}

// Approved spend (same definition as the financial report: approved expenses,
// one row each) and the work done (average milestone completion, NULL when the
// project has no milestones).
async function loadFigures(target, projectId) {
  const result = await runnerOf(target)(
    `SELECT COALESCE((SELECT SUM(amount) FROM expenses WHERE projectid = $1::uuid AND status = 'Approved'), 0)::text AS spent,
            (SELECT ROUND(AVG(completionpercentage), 2)::text FROM milestones WHERE projectid = $1::uuid) AS progress`,
    [projectId]
  );
  const row = result.rows[0];
  return { spent: Number(row.spent), workDonePercent: num(row.progress) };
}

async function buildPayload(target, project, user) {
  const price = await agreedPrice(target, project.projectid);
  const contract = await loadContract(target, project.projectid);
  const base = {
    projectId: project.projectid,
    projectName: project.name,
    projectStatus: project.status,
    projectBudget: num(project.budget),
    agreedPrice: price?.price ?? null,
    bomApproved: Boolean(price?.approved),
    canEdit: user.role === GM && CONTRACT_EDITABLE_STATUSES.includes(project.status),
    canRecordPayments: user.role === GM && project.status !== "Cancelled",
    defaults: { downPaymentPercent: DEFAULT_DOWN_PAYMENT_PERCENT, retentionPercent: DEFAULT_RETENTION_PERCENT },
    // What a new contract form starts with: the project's own details and the
    // price agreed on the BOM. The GM reviews and confirms them.
    prefill: {
      ownerName: project.clientname || null,
      siteLocation: [project.siteaddress, project.municipality].filter(Boolean).join(", ") || null,
      contractAmount: price?.price ?? null,
      downPaymentPercent: DEFAULT_DOWN_PAYMENT_PERCENT,
      retentionPercent: DEFAULT_RETENTION_PERCENT,
    },
  };
  if (!contract) return { ...base, contract: null, payments: [], summary: null };

  const [payments, figures] = await Promise.all([loadPayments(target, contract.contractId), loadFigures(target, project.projectid)]);
  const summary = ledgerSummary({
    contract,
    payments,
    spent: figures.spent,
    agreedPrice: price?.approved ? price.price : null,
    projectBudget: num(project.budget),
    workDonePercent: figures.workDonePercent,
  });
  return { ...base, contract, payments, summary };
}

const validationError = (errors) =>
  httpError(400, errors[0].message, { errors, fieldErrors: errors });

// GET /: the contract, its payments and the ledger summary.
router.get("/", requireRole(GM, PM), async (req, res) => {
  try {
    const project = await loadProject(query, req.params.projectId);
    assertCanView(project, req.user);
    res.json(await buildPayload(query, project, req.user));
  } catch (err) {
    sendError(res, err);
  }
});

// POST /extract: multipart field "file" (.docx). Proposes values for the form.
// Nothing is saved: the GM reviews every value and confirms with PUT /.
router.post("/extract", requireRole(GM), (req, res, next) => {
  upload.single("file")(req, res, (err) => (err ? sendError(res, err) : next()));
}, async (req, res) => {
  try {
    await loadProject(query, req.params.projectId);
    if (!req.file) throw httpError(400, 'Attach the contract file in the "file" field');
    const result = extractContract(req.file.buffer, req.file.originalname);
    res.json({ ...result, fileName: String(req.file.originalname).replace(/[^\w.\- ()]/g, "_").slice(0, 255) });
  } catch (err) {
    sendError(res, err);
  }
});

// PUT /: confirm or update the contract. body = the contract fields (see
// validateContractBody), plus { confirmDifference: true } when the contract
// amount differs from the price agreed on the approved BOM.
router.put("/", requireRole(GM), async (req, res) => {
  try {
    const { errors, value } = validateContractBody(req.body);
    if (errors.length) throw validationError(errors);

    const payload = await withTransaction(async (client) => {
      const project = await loadProject(client, req.params.projectId, { lock: true });
      if (!CONTRACT_EDITABLE_STATUSES.includes(project.status)) {
        throw httpError(409, `The contract of a ${project.status} project can't be changed`);
      }
      const existing = await loadContract(client, project.projectid, { lock: true });
      if (existing) {
        const livePayments = (await loadPayments(client, existing.contractId)).filter((p) => !p.voidedAt);
        const problem = contractChangeProblem(value, livePayments);
        if (problem) throw httpError(409, problem);
      }

      const price = await agreedPrice(client, project.projectid);
      const difference = price?.approved ? priceDifference(value.contractAmount, price.price) : null;
      if (difference?.differs && req.body?.confirmDifference !== true) {
        const err = httpError(409, "The contract amount differs from the price agreed on the approved BOM. Check it, then confirm.");
        err.details = {
          code: "CONFIRM_DIFFERENCE",
          warnings: [
            {
              level: "warning",
              message: `Contract amount ${peso(value.contractAmount)} vs agreed price ${peso(difference.agreedPrice)} (difference ${peso(Math.abs(difference.difference))}).`,
            },
          ],
        };
        throw err;
      }

      await client.query(
        `INSERT INTO projectcontracts
           (projectid, contractref, contractdate, ownername, contractorname, contractorrep, contractoraddress,
            scope, sitelocation, contractamount, downpaymentpercent, retentionpercent,
            durationworkingdays, warrantymonths, sourcefilename, createdby, updatedby)
         VALUES ($1::uuid, $2, $3::date, $4, $5, $6, $7, $8, $9, $10::numeric, $11::numeric, $12::numeric,
                 $13::int, $14::int, $15, $16::uuid, $16::uuid)
         ON CONFLICT (projectid) DO UPDATE SET
           contractref = EXCLUDED.contractref, contractdate = EXCLUDED.contractdate,
           ownername = EXCLUDED.ownername, contractorname = EXCLUDED.contractorname,
           contractorrep = EXCLUDED.contractorrep, contractoraddress = EXCLUDED.contractoraddress,
           scope = EXCLUDED.scope, sitelocation = EXCLUDED.sitelocation,
           contractamount = EXCLUDED.contractamount, downpaymentpercent = EXCLUDED.downpaymentpercent,
           retentionpercent = EXCLUDED.retentionpercent, durationworkingdays = EXCLUDED.durationworkingdays,
           warrantymonths = EXCLUDED.warrantymonths,
           sourcefilename = COALESCE(EXCLUDED.sourcefilename, projectcontracts.sourcefilename),
           updatedby = $16::uuid, updatedat = NOW()`,
        [
          project.projectid,
          value.contractRef,
          value.contractDate,
          value.ownerName,
          value.contractorName,
          value.contractorRep,
          value.contractorAddress,
          value.scope,
          value.siteLocation,
          value.contractAmount,
          value.downPaymentPercent,
          value.retentionPercent,
          value.durationWorkingDays,
          value.warrantyMonths,
          value.sourceFileName,
          req.user.id,
        ]
      );
      return buildPayload(client, project, req.user);
    });
    res.json(payload);
  } catch (err) {
    sendError(res, err);
  }
});

// POST /payments: record money received from the client.
router.post("/payments", requireRole(GM), async (req, res) => {
  try {
    const { errors, value } = validatePaymentBody(req.body);
    if (errors.length) throw validationError(errors);

    const payload = await withTransaction(async (client) => {
      const project = await loadProject(client, req.params.projectId, { lock: true });
      if (project.status === "Cancelled") throw httpError(409, "A cancelled project can't take new payments");
      const contract = await loadContract(client, project.projectid, { lock: true });
      if (!contract) throw httpError(409, "Record the contract first, then the payments against it");

      const livePayments = (await loadPayments(client, contract.contractId)).filter((p) => !p.voidedAt);
      const problem = paymentProblem(value, contract, livePayments, project.status);
      if (problem) throw httpError(409, problem, { fieldErrors: [{ field: "amount", message: problem }] });

      // A progress billing remembers how much of the work was done when it was
      // billed (billing follows progress). The GM can type it; otherwise it is today's.
      let workDonePercent = value.workDonePercent;
      if (value.kind === "Progress Billing" && workDonePercent === null) {
        workDonePercent = (await loadFigures(client, project.projectid)).workDonePercent;
      }

      await client.query(
        `INSERT INTO clientpayments
           (contractid, projectid, kind, amount, receivedon, referenceno, workdonepercent, note, recordedby)
         VALUES ($1::uuid, $2::uuid, $3, $4::numeric, $5::date, $6, $7::numeric, $8, $9::uuid)`,
        [contract.contractId, project.projectid, value.kind, value.amount, value.receivedOn, value.referenceNo, workDonePercent, value.note, req.user.id]
      );
      return buildPayload(client, project, req.user);
    });
    res.status(201).json(payload);
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /payments/:paymentId/void: body { reason }. A wrong entry is voided, not deleted.
router.patch("/payments/:paymentId/void", requireRole(GM), async (req, res) => {
  try {
    let reason;
    try {
      reason = text(req.body?.reason, { field: "reason", label: "A reason", max: 500, required: true });
    } catch (err) {
      if (err instanceof InputError) throw validationError([{ field: err.field, message: err.message }]);
      throw err;
    }
    if (!UUID_RE.test(String(req.params.paymentId))) throw httpError(404, "Payment not found");

    const payload = await withTransaction(async (client) => {
      const project = await loadProject(client, req.params.projectId, { lock: true });
      const found = await client.query(
        `SELECT voidedat FROM clientpayments WHERE paymentid = $1::uuid AND projectid = $2::uuid FOR UPDATE`,
        [req.params.paymentId, project.projectid]
      );
      if (found.rowCount === 0) throw httpError(404, "Payment not found");
      if (found.rows[0].voidedat) throw httpError(409, "That payment is already voided");

      await client.query(
        `UPDATE clientpayments SET voidedat = NOW(), voidedby = $2::uuid, voidreason = $3 WHERE paymentid = $1::uuid`,
        [req.params.paymentId, req.user.id, reason]
      );
      return buildPayload(client, project, req.user);
    });
    res.json(payload);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
