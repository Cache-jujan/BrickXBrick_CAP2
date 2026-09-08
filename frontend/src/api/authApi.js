import { apiClient } from "./client";

// POST /api/auth/login
// Backend returns { token, user: { id, name, email, role }, redirectPath }
export async function login(email, password) {
  const { data } = await apiClient.post("/api/auth/login", { email, password });
  return data;
}

// GET /api/me — used to re-hydrate the session on page refresh.
export async function fetchCurrentUser() {
  const { data } = await apiClient.get("/api/me");
  return data.user;
}
