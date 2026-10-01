// allocations.js — F8 hybrid line-item / quantity allocation.
// Option A remains the source of receiptTotal: the client sends the total
// returned by the existing receipt scan. Line splits are derived from the
// OCR/manual line totals; any subtotal difference needs an explicit reason.

const crypto = require("crypto");
const express = require("express");
const { withTransaction } = require("../lib/db");
const { requireAuth } = require("../middleware/auth");
const { requireRole } = require("../middleware/requireRole");
const { receiptImageExists } = require("../lib/receiptStorage");
const { EXPENSE_COLUMNS, classifyBir } = require("../lib/receiptFields");
const { validateAllocationBody, formatMoneyCents } = require("../lib/allocationValidation");

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

    const projectIDs = allocation.projects.map((project) => project.projectID);
    const result = await withTransaction(async (client) => {
      const projectResult = await client.query(
        `SELECT projectid, projectmanagerid, status
           FROM projects
          WHERE projectid = ANY($1::uuid[])`,
        [projectIDs]
      );
      const projectById = new Map(projectResult.rows.map((project) => [project.projectid, project]));

      for (const projectID of projectIDs) {
        const project = projectById.get(projectID);
        if (!project) {
          const error = new Error(`Project ${projectID} not found`);
          error.status = 404;
          throw error;
        }
        if (project.status !== "Active") {
          const error = new Error(`Project ${projectID} is not active`);
          error.status = 400;
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
      const lineItemIDByNumber = new Map();

      if (allocation.mode === "quantity") {
        for (const line of allocation.lineItems) {
          const lineItemID = crypto.randomUUID();
          lineItemIDByNumber.set(line.lineNumber, lineItemID);
          await client.query(
            `INSERT INTO receiptlineitems
               (lineitemid, commonreceiptid, linenumber, description, quantity, unitprice, amount)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [lineItemID, commonReceiptID, line.lineNumber, line.description, line.quantity, line.unitPrice, line.amount]
          );
        }
      }

      const expenses = [];
      const expenseIDByProject = new Map();
      for (const project of allocation.projects) {
        const projectLineItems = project.lineItems.map((line) => ({
          lineItemID: lineItemIDByNumber.get(line.lineNumber),
          lineNumber: line.lineNumber,
          description: line.description,
          quantity: line.quantity,
          amount: line.amount,
          unitPrice: line.unitPrice,
        }));
        const expenseResult = await client.query(
          `INSERT INTO expenses
             (projectid, submittedby, vendorname, amount, receiptdate, category,
              birvalidationstatus, receiptimageurl, birnumber, quantity, tin,
              birpermitnumber, lineitems)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING ${EXPENSE_COLUMNS}`,
          [
            project.projectID,
            req.user.id,
            allocation.vendorName,
            project.amount,
            allocation.receiptDate,
            allocation.category,
            birValidationStatus,
            allocation.receiptImageURL,
            allocation.birNumber,
            allocation.mode === "quantity" ? project.quantity : null,
            allocation.tin,
            allocation.birPermitNumber,
            JSON.stringify(projectLineItems),
          ]
        );
        const expense = expenseResult.rows[0];
        expenseIDByProject.set(project.projectID, expense.expenseID);
        expenses.push(expense);
      }

      if (allocation.mode === "quantity") {
        for (const portion of allocation.allocations) {
          await client.query(
            `INSERT INTO receiptallocations
               (expenseid, projectid, allocatedamount, commonreceiptid, lineitemid,
                allocationmode, allocatedquantity, adjustmentamount, adjustmenttype)
             VALUES ($1, $2, $3, $4, $5, 'quantity', $6, $7, $8)`,
            [
              expenseIDByProject.get(portion.projectID),
              portion.projectID,
              formatMoneyCents(portion.allocatedAmountCents),
              commonReceiptID,
              lineItemIDByNumber.get(portion.lineNumber),
              portion.allocatedQuantity,
              formatMoneyCents(portion.adjustmentAmountCents),
              allocation.adjustmentType,
            ]
          );
        }
      } else {
        for (const project of allocation.projects) {
          await client.query(
            `INSERT INTO receiptallocations
               (expenseid, projectid, allocatedamount, commonreceiptid, lineitemid,
                allocationmode, allocatedquantity, adjustmentamount, adjustmenttype)
             VALUES ($1, $2, $3, $4, NULL, 'amount', NULL, 0, NULL)`,
            [expenseIDByProject.get(project.projectID), project.projectID, project.amount, commonReceiptID]
          );
        }
      }

      return {
        commonReceiptID,
        mode: allocation.mode,
        receiptTotal: formatMoneyCents(allocation.receiptTotalCents),
        adjustmentType: allocation.adjustmentType,
        adjustmentAmount: formatMoneyCents(allocation.adjustmentAmountCents),
        expenses,
      };
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
