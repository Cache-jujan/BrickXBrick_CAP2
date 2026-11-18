import { apiClient } from "./client";

// F2 contract and client payments: /api/projects/:projectId/contract
// (see backend/src/routes/contract.js)

// GM or the owning PM. Returns { projectId, projectName, projectStatus, projectBudget,
// agreedPrice, bomApproved, canEdit, canRecordPayments, defaults, prefill,
// contract: null | {...}, payments: [...], summary: null | {...} }.
export async function getContract(projectId) {
  const { data } = await apiClient.get(`/api/projects/${projectId}/contract`);
  return data;
}

// GM. Uploads the contract (.docx) and gets proposed form values back:
// { fileName, fields, flags: [{ field, level, message }], found }. Saves nothing.
export async function extractContractFile(projectId, file) {
  const fd = new FormData();
  fd.append("file", file);
  const { data } = await apiClient.post(`/api/projects/${projectId}/contract/extract`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

// GM. Confirms or updates the contract. A 409 with code CONFIRM_DIFFERENCE means the
// contract amount differs from the price agreed on the approved BOM: confirm it and send again.
export async function saveContract(projectId, fields, confirmDifference = false) {
  const { data } = await apiClient.put(`/api/projects/${projectId}/contract`, { ...fields, confirmDifference });
  return data;
}

// GM. Records money received. payment = { kind, amount, receivedOn, referenceNo?, workDonePercent?, note? }
export async function recordPayment(projectId, payment) {
  const { data } = await apiClient.post(`/api/projects/${projectId}/contract/payments`, payment);
  return data;
}

// GM. Voids a wrong payment (it stays on record with the reason).
export async function voidPayment(projectId, paymentId, reason) {
  const { data } = await apiClient.patch(`/api/projects/${projectId}/contract/payments/${paymentId}/void`, { reason });
  return data;
}
