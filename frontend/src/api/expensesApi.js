import { apiClient } from "./client";

// GET /api/expenses — optional project filter, e.g. listExpenses(projectId)
export async function listExpenses(projectId) {
  const { data } = await apiClient.get("/api/expenses", {
    params: projectId ? { projectId } : undefined,
  });
  return data;
}

// GET /api/expenses/mine — Purchaser's own submitted expenses.
export async function listMyExpenses() {
  const { data } = await apiClient.get("/api/expenses/mine");
  return data;
}

// GET /api/expenses/:id — single expense detail.
export async function getExpense(id) {
  const { data } = await apiClient.get(`/api/expenses/${id}`);
  return data;
}

export async function approveExpense(id) {
  const { data } = await apiClient.patch(`/api/expenses/${id}/approve`);
  return data;
}

// The backend returns 400 without a reason.
export async function rejectExpense(id, reason) {
  const { data } = await apiClient.patch(`/api/expenses/${id}/reject`, { reason });
  return data;
}

// PATCH /api/expenses/:id/resubmit — Purchaser resubmits a Rejected expense.
export async function resubmitExpense(id, payload) {
  const { data } = await apiClient.patch(
    `/api/expenses/${id}/resubmit`,
    payload
  );
  return data;
}

// POST /api/receipts/scan — the form field must be named "file".
export async function scanReceipt(file) {
  const fd = new FormData();
  fd.append("file", file);
  const { data } = await apiClient.post("/api/receipts/scan", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

// Background scanning (backend routes/receipts.js). POST /scans answers at once with a
// scanID while OCR keeps running on the server, so the user can go on working.
// `context` is a small JSON object the app gets back later ({ source, mode, fileName }).
export async function startReceiptScan(file, context) {
  const fd = new FormData();
  fd.append("context", JSON.stringify(context));
  fd.append("file", file);
  const { data } = await apiClient.post("/api/receipts/scans", fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

// GET /api/receipts/scans — the caller's recent scans: Scanning, Ready (with the draft) or Failed.
export async function listReceiptScans() {
  const { data } = await apiClient.get("/api/receipts/scans");
  return data;
}

// DELETE /api/receipts/scans/:id — hides a scan (submitted, or discarded).
export async function dismissReceiptScan(scanID) {
  await apiClient.delete(`/api/receipts/scans/${scanID}`);
}

export async function submitExpense(payload) {
  const { data } = await apiClient.post("/api/expenses", payload);
  return data;
}

// GET /api/expenses/flagged — Pending expenses with unresolved fraud flags.
export async function listFlaggedExpenses() {
  const { data } = await apiClient.get("/api/expenses/flagged");
  return data;
}