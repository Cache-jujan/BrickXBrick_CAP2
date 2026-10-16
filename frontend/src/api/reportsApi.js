import { apiClient } from "./client";

// GET /api/reports/summary — General Manager only.
// filters: { projectIds: string[] (1 to 5), from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
// Returns { generatedAt, period, empty, projects: [...], totals: {...},
//           warnings: { pendingExpenses, fraudFlaggedExpenses } }.
// The server recomputes everything on each call; nothing is cached here.
export async function getReportSummary({ projectIds, from, to }) {
  const { data } = await apiClient.get("/api/reports/summary", {
    params: { projectIds: projectIds.join(","), from, to },
  });
  return data;
}
