// F2: the project's Bill of Materials. Mounted at /api/projects/:projectId/bom
//
// Client (Oct 2026): the signed and sealed BOM is "the basis for every purchase
// and mobilization"; it always comes as an Excel file in the company format,
// and the price given to the client is the BOM total.
//
//   GET    /          GM, owning PM     the BOM with totals and review warnings
//   POST   /import    GM                upload the .xlsx; replaces the Draft
//   PUT    /          GM                save the edited Draft (or start one by hand)
//   PATCH  /approve   GM                lock it; the project budget becomes the BOM total
//   PATCH  /reopen    GM                back to Draft for a correction, with a reason
//   DELETE /          GM                remove a Draft BOM (e.g. the wrong file)
//   GET    /items     GM, PM, SM, Purchaser   approved items for Material Requests
//                                      (unit costs only for GM and PM)
//
// Approving the BOM is required before the GM can activate the project.
const express = require("express");
const multer = require("multer");
const { query, withTransaction } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { httpError, notifyProject } = require("../lib/projectRules");
const { parseBomWorkbook } = require("../lib/bomImport");
const {
  laborModeOf,
  sectionTotals,
  bomTotals,
  buildBomWarnings,
  validateBomPayload,
  approvalProblems,
  round2,
} = require("../lib/bomRules");

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

const GM = "General Manager";
const PM = "Project Manager";
const EDITABLE_PROJECT_STATUSES = ["Draft", "Active"];
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || "").toLowerCase();
    if (!name.endsWith(".xlsx")) {
      return cb(httpError(400, "Upload the BOM as an Excel .xlsx file (.xls and macro files .xlsm are not accepted)."));
    }
    if (![XLSX_MIME, "application/octet-stream", ""].includes(file.mimetype)) {
      return cb(httpError(400, `Unsupported file type: ${file.mimetype}. Upload an .xlsx file.`));
    }
    cb(null, true);
  },
});

function sendError(res, err) {
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "The file is larger than 5 MB." : err.message;
    return res.status(400).json({ error: message });
  }
  if (err.code === "23503" && !err.status) {
    return res.status(409).json({
      error: "Some BOM items are already used by Material Requests, so they can't be removed. Edit them instead.",
    });
  }
  if (!err.status) console.error("BOM route error:", err);
  res.status(err.status || 500).json({ error: err.status ? err.message : "Internal server error", ...(err.details || {}) });
}

const runnerOf = (target) => (typeof target === "function" ? target : (t, p) => target.query(t, p));
const n = (v) => (v === null || v === undefined ? null : Number(v));

async function loadProject(target, projectId, { lock = false } = {}) {
  if (!UUID_RE.test(String(projectId))) throw httpError(404, "Project not found");
  const result = await runnerOf(target)(
    `SELECT projectid, name, status, budget, projectmanagerid, sitemanagerid
       FROM projects WHERE projectid = $1::uuid${lock ? " FOR UPDATE" : ""}`,
    [projectId]
  );
  if (result.rowCount === 0) throw httpError(404, "Project not found");
  return result.rows[0];
}

function assertCanView(project, user) {
  if (user.role === GM) return;
  if (user.role === PM && project.projectmanagerid === user.id) return;
  throw httpError(403, "You do not have access to this project's BOM");
}

function assertProjectEditable(project) {
  if (!EDITABLE_PROJECT_STATUSES.includes(project.status)) {
    throw httpError(409, `The BOM of a ${project.status} project can't be changed`);
  }
}

async function loadBomRow(target, projectId, { lock = false } = {}) {
  const result = await runnerOf(target)(
    `SELECT b.*, ua.name AS approvedbyname, ur.name AS reopenedbyname
       FROM boms b
       LEFT JOIN users ua ON ua.userid = b.approvedby
       LEFT JOIN users ur ON ur.userid = b.reopenedby
      WHERE b.projectid = $1::uuid${lock ? " FOR UPDATE OF b" : ""}`,
    [projectId]
  );
  return result.rows[0] || null;
}

// Sections with their items, in file order. inUse = referenced by a ticket.
async function loadSections(target, bomId) {
  const run = runnerOf(target);
  const sections = await run(
    `SELECT sectionid, name, subheading, sortorder, laborrate, laboramount,
            laborincludedinitems, statedmaterialtotal, statedlaboramount
       FROM bomsections WHERE bomid = $1::uuid ORDER BY sortorder`,
    [bomId]
  );
  const items = await run(
    `SELECT i.bomitemid, i.sectionid, i.sortorder, i.description, i.quantity, i.unit,
            i.unitcost, i.estimatedcost,
            EXISTS (SELECT 1 FROM tickets t WHERE t.bomitemid = i.bomitemid) AS inuse
       FROM bomitems i
       JOIN bomsections s ON s.sectionid = i.sectionid
      WHERE s.bomid = $1::uuid
      ORDER BY s.sortorder, i.sortorder`,
    [bomId]
  );
  return sections.rows.map((s) => ({
    sectionId: s.sectionid,
    name: s.name,
    subheading: s.subheading,
    laborRate: n(s.laborrate),
    laborAmount: n(s.laboramount),
    laborIncludedInItems: s.laborincludedinitems,
    statedMaterialTotal: n(s.statedmaterialtotal),
    statedLaborAmount: n(s.statedlaboramount),
    items: items.rows
      .filter((i) => i.sectionid === s.sectionid)
      .map((i) => ({
        bomItemId: i.bomitemid,
        description: i.description,
        quantity: n(i.quantity),
        unit: i.unit,
        unitCost: n(i.unitcost),
        estimatedCost: n(i.estimatedcost),
        inUse: i.inuse,
      })),
  }));
}

async function buildResponse(target, project) {
  const bom = await loadBomRow(target, project.projectid);
  const base = { projectId: project.projectid, projectStatus: project.status, projectBudget: n(project.budget) };
  if (!bom) return { ...base, bom: null };
  const sections = await loadSections(target, bom.bomid);
  return {
    ...base,
    bom: {
      bomId: bom.bomid,
      status: bom.status,
      sourceFileName: bom.sourcefilename,
      statedTotal: n(bom.statedtotal),
      createdAt: bom.createdat,
      updatedAt: bom.updatedat,
      approvedAt: bom.approvedat,
      approvedByName: bom.approvedbyname,
      reopenedAt: bom.reopenedat,
      reopenedByName: bom.reopenedbyname,
      revisionNote: bom.revisionnote,
      sections: sections.map((s) => ({ ...s, laborMode: laborModeOf(s), totals: sectionTotals(s) })),
      totals: bomTotals(sections),
      warnings: buildBomWarnings(sections, { statedTotal: n(bom.statedtotal) }),
    },
  };
}

async function insertSection(client, bomId, s, sortOrder) {
  // One labor mode only (matches the bomsections_labor_one_mode check).
  const laborRate = s.laborIncludedInItems ? null : s.laborRate ?? null;
  const laborAmount = s.laborIncludedInItems || laborRate !== null ? null : s.laborAmount ?? null;
  const result = await client.query(
    `INSERT INTO bomsections (bomid, name, subheading, sortorder, laborrate, laboramount,
                              laborincludedinitems, statedmaterialtotal, statedlaboramount)
     VALUES ($1::uuid, $2, $3, $4::int, $5::numeric, $6::numeric, $7::boolean, $8::numeric, $9::numeric)
     RETURNING sectionid`,
    [
      bomId,
      s.name,
      s.subheading ?? null,
      sortOrder,
      laborRate,
      laborAmount,
      Boolean(s.laborIncludedInItems),
      s.statedMaterialTotal ?? null,
      s.statedLaborAmount ?? null,
    ]
  );
  return result.rows[0].sectionid;
}

async function insertItem(client, sectionId, it, sortOrder) {
  await client.query(
    `INSERT INTO bomitems (sectionid, sortorder, description, quantity, unit, unitcost)
     VALUES ($1::uuid, $2::int, $3, $4::numeric, $5, $6::numeric)`,
    [sectionId, sortOrder, it.description, it.quantity, it.unit, it.unitCost]
  );
}

async function deleteAllSections(client, bomId) {
  await client.query(
    `DELETE FROM bomitems WHERE sectionid IN (SELECT sectionid FROM bomsections WHERE bomid = $1::uuid)`,
    [bomId]
  );
  await client.query(`DELETE FROM bomsections WHERE bomid = $1::uuid`, [bomId]);
}

// Creates the BOM row if the project has none. Returns the locked row.
async function ensureDraftBom(client, project, userId, { sourceFileName, statedTotal, replaceSource = false }) {
  let bom = await loadBomRow(client, project.projectid, { lock: true });
  if (!bom) {
    await client.query(
      `INSERT INTO boms (projectid, sourcefilename, statedtotal, createdby, updatedby)
       VALUES ($1::uuid, $2, $3::numeric, $4::uuid, $4::uuid)`,
      [project.projectid, sourceFileName ?? null, statedTotal ?? null, userId]
    );
    bom = await loadBomRow(client, project.projectid, { lock: true });
  } else if (bom.status === "Approved") {
    throw httpError(409, "The BOM is approved and locked. Reopen it for revision first.");
  } else if (replaceSource) {
    await client.query(
      `UPDATE boms SET sourcefilename = $2, statedtotal = $3::numeric WHERE bomid = $1::uuid`,
      [bom.bomid, sourceFileName ?? null, statedTotal ?? null]
    );
  }
  return bom;
}

async function touch(client, bomId, userId) {
  await client.query(`UPDATE boms SET updatedby = $2::uuid, updatedat = NOW() WHERE bomid = $1::uuid`, [bomId, userId]);
}

// ---------------------------------------------------------------------------

router.get("/", requireRole(GM, PM), async (req, res) => {
  try {
    const project = await loadProject(query, req.params.projectId);
    assertCanView(project, req.user);
    res.json(await buildResponse(query, project));
  } catch (err) {
    sendError(res, err);
  }
});

// POST /import — multipart field "file". Parses the company BOM layout and
// replaces the whole Draft. The header block and the signatures are skipped.
router.post("/import", requireRole(GM), (req, res, next) => {
  upload.single("file")(req, res, (err) => (err ? sendError(res, err) : next()));
}, async (req, res) => {
  try {
    if (!req.file) throw httpError(400, 'Attach the BOM file in the "file" field');
    const buf = req.file.buffer;
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      throw httpError(400, "The file is not a valid .xlsx workbook.");
    }
    const parsed = await parseBomWorkbook(buf);
    const fileName = String(req.file.originalname).replace(/[^\w.\- ()]/g, "_").slice(0, 255);

    const payload = await withTransaction(async (client) => {
      const project = await loadProject(client, req.params.projectId, { lock: true });
      assertProjectEditable(project);
      const bom = await ensureDraftBom(client, project, req.user.id, {
        sourceFileName: fileName,
        statedTotal: parsed.statedTotal,
        replaceSource: true,
      });
      await deleteAllSections(client, bom.bomid);
      for (const [si, s] of parsed.sections.entries()) {
        const sectionId = await insertSection(client, bom.bomid, s, si + 1);
        for (const [ii, it] of s.items.entries()) await insertItem(client, sectionId, it, ii + 1);
      }
      await touch(client, bom.bomid, req.user.id);
      return buildResponse(client, project);
    });

    res.status(201).json({
      ...payload,
      importReport: {
        fileName,
        sheetName: parsed.sheetName,
        skippedRows: parsed.skippedRows,
        rowWarnings: parsed.rowWarnings,
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

// PUT / — save the GM's edits to the Draft, or start a BOM by hand.
// Sections and items keep their ids; ones left out are deleted unless a
// Material Request already uses them. Figures "as written in the file" stay.
router.put("/", requireRole(GM), async (req, res) => {
  try {
    const sections = validateBomPayload(req.body);

    const payload = await withTransaction(async (client) => {
      const project = await loadProject(client, req.params.projectId, { lock: true });
      assertProjectEditable(project);
      const bom = await ensureDraftBom(client, project, req.user.id, {});
      const existing = await loadSections(client, bom.bomid);

      const existingSections = new Map(existing.map((s) => [s.sectionId, s]));
      const existingItems = new Map();
      existing.forEach((s) => s.items.forEach((it) => existingItems.set(it.bomItemId, it)));

      const keptSections = new Set();
      const keptItems = new Set();
      for (const s of sections) {
        if (s.sectionId && !existingSections.has(s.sectionId)) throw httpError(400, `Unknown section ${s.sectionId}`);
        if (s.sectionId) keptSections.add(s.sectionId);
        for (const it of s.items) {
          if (!it.bomItemId) continue;
          const old = existingItems.get(it.bomItemId);
          if (!old) throw httpError(400, `Unknown BOM item ${it.bomItemId}`);
          if (keptItems.has(it.bomItemId)) throw httpError(400, `BOM item ${it.bomItemId} is listed twice`);
          if (old.inUse && old.unit.trim().toLowerCase() !== it.unit.trim().toLowerCase()) {
            throw httpError(409, `The unit of "${old.description}" can't change: Material Requests already use it.`);
          }
          keptItems.add(it.bomItemId);
        }
      }

      for (const it of existingItems.values()) {
        if (!keptItems.has(it.bomItemId) && it.inUse) {
          throw httpError(409, `"${it.description}" is used by a Material Request and can't be removed.`);
        }
      }

      // Delete removed items first, then removed sections.
      const removedItems = [...existingItems.keys()].filter((id) => !keptItems.has(id));
      if (removedItems.length) {
        await client.query(`DELETE FROM bomitems WHERE bomitemid = ANY($1::uuid[])`, [removedItems]);
      }
      const removedSections = [...existingSections.keys()].filter((id) => !keptSections.has(id));

      for (const [si, s] of sections.entries()) {
        let sectionId = s.sectionId;
        const laborRate = s.laborIncludedInItems ? null : s.laborRate;
        const laborAmount = s.laborIncludedInItems || laborRate !== null ? null : s.laborAmount;
        if (sectionId) {
          await client.query(
            `UPDATE bomsections
                SET name = $2, subheading = $3, sortorder = $4::int, laborrate = $5::numeric,
                    laboramount = $6::numeric, laborincludedinitems = $7::boolean
              WHERE sectionid = $1::uuid`,
            [sectionId, s.name, s.subheading, si + 1, laborRate, laborAmount, s.laborIncludedInItems]
          );
        } else {
          sectionId = await insertSection(client, bom.bomid, { ...s, laborRate, laborAmount }, si + 1);
        }
        for (const [ii, it] of s.items.entries()) {
          if (it.bomItemId) {
            await client.query(
              `UPDATE bomitems
                  SET sectionid = $2::uuid, sortorder = $3::int, description = $4,
                      quantity = $5::numeric, unit = $6, unitcost = $7::numeric
                WHERE bomitemid = $1::uuid`,
              [it.bomItemId, sectionId, ii + 1, it.description, it.quantity, it.unit, it.unitCost]
            );
          } else {
            await insertItem(client, sectionId, it, ii + 1);
          }
        }
      }

      if (removedSections.length) {
        await client.query(`DELETE FROM bomsections WHERE sectionid = ANY($1::uuid[])`, [removedSections]);
      }
      await touch(client, bom.bomid, req.user.id);
      return buildResponse(client, project);
    });
    res.json(payload);
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /approve — body { confirmWarnings: true } when there are warnings.
router.patch("/approve", requireRole(GM), async (req, res) => {
  try {
    const result = await withTransaction(async (client) => {
      const project = await loadProject(client, req.params.projectId, { lock: true });
      assertProjectEditable(project);
      const bom = await loadBomRow(client, project.projectid, { lock: true });
      if (!bom) throw httpError(404, "This project has no BOM yet");
      if (bom.status === "Approved") throw httpError(409, "The BOM is already approved");

      const sections = await loadSections(client, bom.bomid);
      const problems = approvalProblems(sections);
      if (problems.length) throw httpError(409, problems.join(" "));

      const warnings = buildBomWarnings(sections, { statedTotal: n(bom.statedtotal) }).filter((w) => w.level === "warning");
      if (warnings.length && req.body?.confirmWarnings !== true) {
        const err = httpError(409, "Check the warnings against the signed BOM, then confirm to approve.");
        err.details = { code: "CONFIRM_WARNINGS", warnings };
        throw err;
      }

      const totals = bomTotals(sections);
      await client.query(
        `UPDATE boms SET status = 'Approved', approvedby = $2::uuid, approvedat = NOW(),
                         updatedby = $2::uuid, updatedat = NOW()
          WHERE bomid = $1::uuid`,
        [bom.bomid, req.user.id]
      );
      // Client: the price given to the client is the BOM total.
      const previousBudget = n(project.budget);
      if (round2(previousBudget) !== totals.total) {
        await client.query(`UPDATE projects SET budget = $2::numeric WHERE projectid = $1::uuid`, [
          project.projectid,
          totals.total,
        ]);
      }
      await notifyProject(client, {
        recipientId: project.projectmanagerid,
        type: "BOMApproved",
        projectId: project.projectid,
        message: `The Bill of Materials for "${project.name}" was approved (₱${totals.total.toLocaleString("en-PH")}).`,
      });
      const fresh = await loadProject(client, project.projectid);
      return { ...(await buildResponse(client, fresh)), previousBudget };
    });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

// PATCH /reopen — body { reason }. Approved -> Draft so the GM can correct it.
router.patch("/reopen", requireRole(GM), async (req, res) => {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) throw httpError(400, "A reason is required to reopen the BOM");
    if (reason.length > 1000) throw httpError(400, "The reason is too long (1000 characters max)");

    const result = await withTransaction(async (client) => {
      const project = await loadProject(client, req.params.projectId, { lock: true });
      assertProjectEditable(project);
      const bom = await loadBomRow(client, project.projectid, { lock: true });
      if (!bom) throw httpError(404, "This project has no BOM yet");
      if (bom.status !== "Approved") throw httpError(409, "Only an approved BOM can be reopened");

      await client.query(
        `UPDATE boms SET status = 'Draft', reopenedby = $2::uuid, reopenedat = NOW(), revisionnote = $3,
                         updatedby = $2::uuid, updatedat = NOW()
          WHERE bomid = $1::uuid`,
        [bom.bomid, req.user.id, reason]
      );
      await notifyProject(client, {
        recipientId: project.projectmanagerid,
        type: "BOMReopened",
        projectId: project.projectid,
        message: `The Bill of Materials for "${project.name}" was reopened for revision: ${reason}`,
      });
      return buildResponse(client, project);
    });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

// DELETE / — remove a Draft BOM of a Draft project (e.g. the wrong file was uploaded).
router.delete("/", requireRole(GM), async (req, res) => {
  try {
    await withTransaction(async (client) => {
      const project = await loadProject(client, req.params.projectId, { lock: true });
      if (project.status !== "Draft") throw httpError(409, "Only the BOM of a Draft project can be removed");
      const bom = await loadBomRow(client, project.projectid, { lock: true });
      if (!bom) throw httpError(404, "This project has no BOM");
      if (bom.status === "Approved") throw httpError(409, "Reopen the approved BOM before removing it");
      await deleteAllSections(client, bom.bomid);
      await client.query(`DELETE FROM boms WHERE bomid = $1::uuid`, [bom.bomid]);
    });
    res.status(204).end();
  } catch (err) {
    sendError(res, err);
  }
});

// GET /items?search= — items of the APPROVED BOM, for Material Requests.
// GM and the owning PM see unit costs; the assigned SM and Purchasers don't.
router.get("/items", requireRole(GM, PM, "Site Manager", "Purchaser"), async (req, res) => {
  try {
    const project = await loadProject(query, req.params.projectId);
    const { role, id } = req.user;
    if (role === PM && project.projectmanagerid !== id) throw httpError(403, "You do not have access to this project");
    if (role === "Site Manager" && project.sitemanagerid !== id) throw httpError(403, "You are not assigned to this project");

    const bom = await loadBomRow(query, project.projectid);
    if (!bom || bom.status !== "Approved") {
      return res.json({ status: bom ? bom.status : null, items: [] });
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
    const showCost = role === GM || role === PM;
    const result = await query(
      `SELECT i.bomitemid, i.description, i.quantity, i.unit, i.unitcost, s.name AS section
         FROM bomitems i
         JOIN bomsections s ON s.sectionid = i.sectionid
        WHERE s.bomid = $1::uuid
          AND ($2::text = '' OR i.description ILIKE '%' || $2::text || '%' OR s.name ILIKE '%' || $2::text || '%')
        ORDER BY s.sortorder, i.sortorder`,
      [bom.bomid, search.replace(/[%_\\]/g, (c) => `\\${c}`)]
    );
    res.json({
      status: bom.status,
      items: result.rows.map((r) => ({
        bomItemId: r.bomitemid,
        section: r.section,
        description: r.description,
        quantity: n(r.quantity),
        unit: r.unit,
        ...(showCost ? { unitCost: n(r.unitcost) } : {}),
      })),
    });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
