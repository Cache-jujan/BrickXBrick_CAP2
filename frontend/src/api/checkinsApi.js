import { apiClient } from "./client";

// Daily progress check-ins, as the Project Manager sees them.
// The Site Manager sends them from the mobile app; the web only reads and reviews.

// GET /api/checkins/project/:projectId?from=&to=   (PM of the project, or GM)
// -> { project, from, to, windows, grid, checkins, counts }
//    grid:     [{ day, slots: [{ slot, label, state }] }]  state: Submitted | Open | Upcoming | Missed | NotRequired
//    checkins: [{ checkinId, day, slot, slotLabel, siteStatus, summary, issues, needsPmAction, onTime,
//                 submittedByName, submittedAt, photos: [url], tasks: [{ taskId, taskName }], review }]
//    review:   null | { decision: "Acknowledged" | "Flagged", comment, reviewedAt, reviewedByName }
export async function getProjectCheckins(projectId, { from, to } = {}) {
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  const { data } = await apiClient.get(`/api/checkins/project/${projectId}`, { params });
  return data;
}

// PATCH /api/checkins/:id/review   (Project Manager of the project only)
// A Flag needs a comment (up to 500 characters) and tells the Site Manager.
export async function reviewCheckin(checkinId, { decision, comment }) {
  const { data } = await apiClient.patch(`/api/checkins/${checkinId}/review`, { decision, comment });
  return data;
}
