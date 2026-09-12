import axios from "axios";

// Base URL comes from Vite env — set VITE_API_URL in .env (see .env.example).
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

export const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// Attach the stored token to every outgoing request, if we have one.
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("bxb_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Centralize the "your session died" case. 401 here always means the
// token is missing/invalid/expired — requireAuth on the backend never
// uses 401 for anything else (DB errors are 500, RBAC failures are 403).
let onUnauthorized = () => {};
export function registerUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      onUnauthorized();
    }
    return Promise.reject(error);
  }
);

// Normalizes backend error shapes ({ error: "..." }) into a plain string
// so pages don't each re-implement this.
export function extractErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  return error?.response?.data?.error || fallback;
}
