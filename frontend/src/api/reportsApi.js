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

// Errors from a blob request arrive as a Blob, not JSON. Read the message out of
// it so extractErrorMessage() works the same as for every other call.
async function unwrapBlobError(error) {
  const data = error?.response?.data;
  if (data instanceof Blob) {
    try {
      error.response.data = JSON.parse(await data.text());
    } catch {
      error.response.data = {};
    }
  }
  return error;
}

function filenameFrom(contentDisposition, fallback) {
  const match = /filename="?([^";]+)"?/i.exec(contentDisposition || "");
  return match ? match[1] : fallback;
}

// POST /api/reports/pdf — General Manager only.
// chartImage: the chart as a PNG data URL (chart.toBase64Image()). It is the
// only thing taken from the browser; the server recomputes every figure.
// Returns { blob, filename, reportId, anchorStatus: "Confirmed" | "Pending" }.
// A fetch with the Bearer header is needed because a plain link can't send it.
export async function downloadReportPdf({ projectIds, from, to, chartImage }) {
  try {
    const response = await apiClient.post(
      "/api/reports/pdf",
      { projectIds, from, to, chartImage },
      { responseType: "blob" }
    );
    return {
      blob: response.data,
      filename: filenameFrom(response.headers["content-disposition"], `brickxbrick-report-${from}-to-${to}.pdf`),
      reportId: response.headers["x-report-id"],
      anchorStatus: response.headers["x-report-anchor-status"],
    };
  } catch (error) {
    throw await unwrapBlobError(error);
  }
}

// POST /api/reports/:id/anchor — retry securing a Pending report on the
// blockchain. Resolves with { anchorStatus: "Confirmed" | "Pending", txHash?, warning? }
// (200 when Confirmed, 202 while the network is still unavailable).
export async function anchorReport(reportId) {
  const { data } = await apiClient.post(`/api/reports/${reportId}/anchor`);
  return data;
}

// Hand the downloaded PDF to the browser as a file.
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
