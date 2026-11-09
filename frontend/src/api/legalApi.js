import { apiClient } from "./client";

// Terms of Use + Privacy Notice (backend/src/routes/legal.js)

// GET /api/legal — public. { version, effectiveDate, documents: [{ id, title, sections }] }
export async function getLegalDocuments() {
  const { data } = await apiClient.get("/api/legal");
  return data;
}

// POST /api/legal/accept — signed-in user accepts the current version.
// A 409 means the version changed while the page was open; reload the text.
export async function acceptTerms(version) {
  const { data } = await apiClient.post("/api/legal/accept", { version });
  return data;
}

// GET /api/legal/status — { version, accepted, acceptedAt } for the signed-in user.
export async function getAcceptanceStatus() {
  const { data } = await apiClient.get("/api/legal/status");
  return data;
}
