# F8 Design Amendment — Hybrid Line-Item / Quantity Allocation

**Status:** Approved redesign implementation amendment
**Supersedes:** Amount-only wording in UC-08-01 and Figure 65 of the compiled CAP1 specification for F8 behavior.
**Scope:** F8 receipt allocation only. The original 411-page CAP1 PDF is a compiled artifact and is not edited in place; this versioned amendment is the source-controlled replacement until the source specification is revised.

## 1. Design decision

F8 supports two explicit modes:

1. **Quantity / line-item mode (preferred):** the user assigns each receipt line, or a quantity from a line, to one or more active projects. The system calculates peso amounts from the receipt line total and allocated quantity.
2. **Manual amount fallback:** when OCR does not provide usable lines or the receipt is a lump sum, the user enters a peso amount per project. These amounts must sum exactly to the receipt total.

The backend always persists PHP amounts in decimal currency columns. Calculations and reconciliation use integer centavos.

### Source values and calculated values

- `lineItems[].amount` is the total amount for that source receipt line, not a unit price.
- `lineItems[].quantity` is the receipt quantity for that line.
- The user enters only `allocations[].quantity` for quantity mode. `unitPrice` is retained as reference data and is not multiplied to derive the share; receipts may include discounts, rounding, or non-clean unit prices.
- Each line's amount is divided among its project assignments in proportion to allocated quantity, using a deterministic largest-remainder method so the centavo shares sum exactly to that line's amount. Ties are broken by ascending project UUID within line number, so resubmitting reordered rows does not change the peso result.
- When the line-item subtotal differs from the receipt total, the user must choose an adjustment type (`tax`, `discount`, `fee`, `rounding`, or `other`). The system distributes the signed difference proportionally over the line/project base amounts, again using largest remainder at centavo precision with ties by line number then project UUID. The final project amounts must sum exactly to `receiptTotal` and no allocation may become negative.
- If the OCR items are incomplete or untrustworthy, the user may use manual amount mode instead of accepting an unexplained difference. If there are partial OCR results, the user can correct/add a line before submitting.

## 2. Revised UC-08-01 flow

**Trigger:** A Purchaser (or authorized GM/PM backup) has a receipt covering purchases for at least two active projects.

1. The actor starts from a receipt scan/review draft containing the receipt image, vendor, date, total, and any OCR line items.
2. The actor selects at least two active projects for the split.
3. In quantity mode, the system displays every receipt line, its description, receipt quantity, and line total. The actor assigns all of each line's quantity across project rows; a line may be split among multiple projects.
4. The UI shows each project's derived peso amount and the receipt-level total. Quantity entered across project rows for each line must equal that line's receipt quantity.
5. If the line-item subtotal differs from the receipt total, the UI displays the difference and requires an explicit adjustment reason. The system prorates that difference over the base line/project amounts; it never silently hides the difference.
6. If usable lines are unavailable, the actor can switch to manual amount fallback and enter a peso amount per project. The manual amounts must sum exactly to the receipt total.
7. The actor submits. The backend verifies the uploaded receipt, active projects, role/project permissions, quantity totals or manual amount sum, and final receipt-total reconciliation.
8. In one database transaction, the backend creates one `Expenses` row per project, source rows in `ReceiptLineItems` for quantity mode, and one or more `ReceiptAllocations` detail rows tied to each project's expense. All rows share one `commonReceiptID`.
9. The response returns the shared identifier, allocation mode, adjustment summary, and project expense rows. A failed insert rolls back the full split.
10. F12 notarization, if required by the team integration plan, occurs after commit per approved expense; it is not part of the F8 allocation transaction.

## 3. Figure 65 replacement wireframe specification

Replace the amount-only project-row form with this structure:

```text
┌──────────────────────────── Split receipt ──────────────────────────────┐
│ Receipt image / vendor / date                 Receipt total: ₱11,240.00 │
│ Mode: [ Assign item quantities ] [ Manual amount fallback ]              │
├─────────────────────────────────────────────────────────────────────────┤
│ Receipt line       Receipt qty   Line total   Project split              │
│ Cement bags        50 bags       ₱8,250.00    Site A: [30]  Site B: [20] │
│ Sand               10 sacks      ₱1,990.00    Site A: [ 0]  Site B: [10] │
│ + Add/correct line item                                                │
├─────────────────────────────────────────────────────────────────────────┤
│ Item subtotal: ₱10,240.00   Difference: +₱1,000.00                      │
│ Reconcile as: [Tax ▼]  (difference is distributed proportionally)       │
│ Site A calculated: ₱5,433.40   Site B calculated: ₱5,806.60             │
│ Allocated total: ₱11,240.00 / ₱11,240.00                                │
│ [Submit allocation — enabled only when valid and reconciled]             │
└─────────────────────────────────────────────────────────────────────────┘
```

Manual fallback replaces the line grid with project + peso amount rows and the same live receipt-total comparison. Invalid states identify the specific line quantity or centavo discrepancy; they do not silently adjust values.

## 4. API contract

### Quantity / line-item mode

`POST /api/allocations`

```json
{
  "receiptImageURL": "https://api.example/receipts/files/<uuid>.jpg",
  "vendorName": "Building Supply",
  "receiptDate": "2026-09-10",
  "category": "Materials",
  "tin": "123456789000",
  "birPermitNumber": "FP012345",
  "birNumber": "OR-123",
  "receiptTotal": 11240,
  "adjustmentType": "tax",
  "lineItems": [
    { "lineNumber": 1, "description": "Cement bags", "quantity": 50, "amount": 8250, "unitPrice": 165 },
    { "lineNumber": 2, "description": "Sand", "quantity": 10, "amount": 1990, "unitPrice": 199 }
  ],
  "allocations": [
    { "lineNumber": 1, "projectID": "ef403363-8377-46ee-902f-54634c558356", "quantity": 30 },
    { "lineNumber": 1, "projectID": "17cb7b95-8b0f-41e9-bf95-4909090b98a6", "quantity": 20 },
    { "lineNumber": 2, "projectID": "17cb7b95-8b0f-41e9-bf95-4909090b98a6", "quantity": 10 }
  ]
}
```

Every source line must have at least one assignment, and its assigned quantities must sum exactly to its receipt quantity. At least two distinct projects must receive a share.

### Manual amount fallback

When no usable OCR line items exist, send `manualAmountAllocations` instead of `lineItems` and `allocations`:

```json
{
  "receiptImageURL": "https://api.example/receipts/files/<uuid>.jpg",
  "vendorName": "Small Vendor",
  "receiptDate": "2026-09-10",
  "category": "Materials",
  "receiptTotal": 45.75,
  "manualAmountAllocations": [
    { "projectID": "ef403363-8377-46ee-902f-54634c558356", "amount": 20 },
    { "projectID": "17cb7b95-8b0f-41e9-bf95-4909090b98a6", "amount": 25.75 }
  ]
}
```

For itemized mode, `adjustmentType` is required only when `sum(lineItems[].amount) != receiptTotal`; it must be omitted when the totals already match. In manual mode, project amounts must exactly equal `receiptTotal` and no adjustment is accepted.

## 5. Persistence model

- `ReceiptLineItems` stores one immutable source line per receipt: `lineItemID`, `commonReceiptID`, `lineNumber`, `description`, receipt `quantity`, optional `unitPrice`, and source line `amount`.
- `ReceiptAllocations` remains the project-level allocation ledger. A quantity-mode row references a source `lineItemID` and stores `allocatedQuantity`, final `allocatedAmount`, signed `adjustmentAmount`, optional `adjustmentType`, `expenseID`, `projectID`, and `commonReceiptID`. Multiple rows may link one expense to multiple receipt lines.
- Manual amount mode writes one amount-mode allocation row per project with no line item and no allocated physical quantity.
- `Expenses.amount` is the sum of that project's final allocation rows. In quantity mode, `Expenses.lineItems` contains that project's allocated line fragments and `Expenses.quantity` is its allocated physical quantity. In manual fallback, `lineItems` is an empty array and `quantity` is NULL (no fabricated unit count).
- Historical amount-only `ReceiptAllocations` records migrate as `allocationMode = 'amount'`; the new line fields remain NULL for those rows.

### Existing use-case integration questions not silently changed here

- The compiled UC-08-01 also says each portion links to a procurement ticket and that the ticket becomes `Allocated`. The current F8 API/schema does not implement that contract, and the current Tickets status constraint does not include `Allocated`. Resolve this with the F4 owner before adding ticket linking or changing shared ticket states.
- The team workbook assigns post-commit notarization of each portion to F12. This implementation does not call Carl's F12 function; keep that as a separate integration after the allocation transaction commits.
- The mobile split UI is not part of this backend/data-model change. The wireframe requirements above are the design target for that follow-up client work.

## 6. Revised unit-test cases (UTC003/UTC004)

| Test | Given | Expected |
|---|---|---|
| UTC003 — Quantity split | Cement line: 50 bags, ₱8,250; assign 30 to Project A and 20 to Project B; receipt total ₱8,250 | Valid. Derived allocations are ₱4,950 and ₱3,300; total is exact; quantities and source-line references are preserved. |
| UTC004 — Invalid quantity/reconciliation | A line has 50 bags but assignments total 49, or line subtotal differs from receipt total without a chosen adjustment type | HTTP 400; no rows are inserted. Error identifies the under/over-allocation or receipt difference. |
| UTC005 — Proportional tax | Same 30/20 split, ₱8,250 subtotal, ₱990 tax adjustment, receipt total ₱9,240 | Tax is distributed by base amount; final allocations are ₱5,544 and ₱3,696, exact to cents. |
| UTC006 — Manual fallback | No usable line items; direct project amounts are ₱20 and ₱25.75; total ₱45.75 | Valid amount-mode rows; quantities are NULL; no source line is invented. |
| UTC007 — Manual mismatch | Manual project amounts sum to ₱40 against a ₱45.75 receipt | HTTP 400 with a ₱5.75 mismatch; no writes. |
| UTC008 — Centavo rounding | A line total of ₱0.01 is allocated equally by quantity to two projects | One project receives the centavo using deterministic largest remainder; combined line amount remains exactly ₱0.01. |

The repository's focused tests cover these validation/arithmetic cases. Database rollback, receipt-file integrity, role denial, and persisted row relationships require the F8 API integration script against a configured test database.
