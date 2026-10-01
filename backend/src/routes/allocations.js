// allocations.js — F8 split-receipt allocation.
// Option A: the client sends receiptTotal from its existing receipt scan; this
// route compares it with the portions in integer centavos before any DB write.

const crypto = require("crypto");
const express = require("express");
const { withTransaction } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { receiptImageExists } = require("../lib/receiptStorage");
const { EXPENSE_COLUMNS, classifyBir } = require("../lib/receiptFields");
const { validateAllocationBody } = require("../lib/allocationValidation");

const router = express.Router();
router.use(requireAuth);

router.post("/", requireRole("Purchaser", "Project Manager", "General Manager"), async (req, res, next) => {
  try {
    const allocation = validateAllocationBody(req.body);

    if (!(await receiptImageExists(allocation.receiptImageURL))) {
      const error = new Error("receiptImageURL must reference a receipt uploaded via POST /api/receipts/scan");
      error.status = 400;
      throw error;
    }

    const projectIDs = allocation.portions.map((portion) => portion.projectID);
    const createdExpenses = await withTransaction(async (client) => {
      const projects = await client.query(
        `SELECT projectid, projectmanagerid
           FROM projects
          WHERE projectid = ANY($1::uuid[])`,
        [projectIDs]
      );
      const projectById = new Map(projects.rows.map((project) => [project.projectid, project]));

      for (const projectID of projectIDs) {
        const project = projectById.get(projectID);
        if (!project) {
          const error = new Error(`Project ${projectID} not found`);
          error.status = 404;
          throw error;
        }
        if (req.user.role === "Project Manager" && project.projectmanagerid !== req.user.id) {
          const error = new Error("You may only allocate expenses to projects you manage");
          error.status = 403;
          throw error;
        }
      }

      const commonReceiptID = crypto.randomUUID();
      const { birValidationStatus } = classifyBir(allocation);
      const expenses = [];

      for (const portion of allocation.portions) {
        // The split payload has no per-project item quantities. Expenses.quantity
        // is NOT NULL, so each persisted allocation is recorded as one receipt
        // portion; lineItems stays NULL rather than inventing item details.
        const expenseResult = await client.query(
          `INSERT INTO expenses
             (projectid, submittedby, vendorname, amount, receiptdate, category,
              birvalidationstatus, receiptimageurl, birnumber, quantity, tin,
              birpermitnumber, lineitems)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $11, NULL)
           RETURNING ${EXPENSE_COLUMNS}`,
          [
            portion.projectID,
            req.user.id,
            allocation.vendorName,
            portion.amount,
            allocation.receiptDate,
            allocation.category,
            birValidationStatus,
            allocation.receiptImageURL,
            allocation.birNumber,
            allocation.tin,
            allocation.birPermitNumber,
          ]
        );
        const expense = expenseResult.rows[0];

        await client.query(
          `INSERT INTO receiptallocations (expenseid, projectid, allocatedamount, commonreceiptid)
           VALUES ($1, $2, $3, $4)`,
          [expense.expenseID, portion.projectID, portion.amount, commonReceiptID]
        );
        expenses.push(expense);
      }

      return { commonReceiptID, expenses };
    });

    res.status(201).json(createdExpenses);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
